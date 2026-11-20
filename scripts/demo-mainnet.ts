// The mainnet side of scripts/demo-escrow.ts (row DM2, decision 0020): the project's test wallet pays for staging the
// public demo escrow, through the spending gate, and only through a host in mainnet.broadcastHosts. The demo keys sign
// the escrow's own calls; their coins are not wallet coins, so the gate counts those calls at 0 sats and counts in
// full every payment the wallet makes to them. Prints public addresses, txids and amounts; never the phrase or a key.
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { Network, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import type { JaminConfig } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { lockOf, party, satsAt, type Party, type PartyName } from '../src/lifecycle/context.js';
import { pay } from '../src/lifecycle/mainnet.js';
import { gather } from '../src/wallet/gather.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';
import { readEnvValue } from '../src/wallet/env-file.js';
import type { Pay } from '../src/demo/stage.js';
import { FundsShort } from '../src/demo/pool.js';
import { ROLE_OF } from './lifecycle-mainnet.js';

export interface MainnetNet {
  provider: NetworkProvider;
  /** The provider without the gate, for reading only. */
  raw: NetworkProvider;
  electrum: ElectrumNetworkProvider;
  pay: Pay;
  returnAddress: string;
  node: string;
}

export class MainnetRefused extends Error {}

/**
 * What the wallet must hold at the seller before staging: the seller and buyer coins plus a fee margin each. That is
 * the peak: the seller's fee coins are paid after the demo keys' change came back to the wallet (src/demo/stage.ts).
 */
export function stagingNeed(d: { sellerCoinSats: number; buyerCoinSats: number }): bigint {
  const FEE_MARGIN = 3_000;
  return BigInt(d.sellerCoinSats + d.buyerCoinSats + 2 * FEE_MARGIN);
}

export async function mainnetNet(cfg: JaminConfig, repoRoot: string, need: bigint): Promise<MainnetNet> {
  const server = cfg.electrum.mainnet;
  if (!cfg.mainnet.broadcastHosts.includes(server.hostname)) {
    throw new MainnetRefused(`refused: ${server.hostname} is not in mainnet.broadcastHosts`);
  }
  const phrase = process.env[cfg.wallet.mnemonicEnv] ?? readEnvValue(join(repoRoot, cfg.wallet.envFile), cfg.wallet.mnemonicEnv);
  if (!phrase) throw new MainnetRefused(`${cfg.wallet.mnemonicEnv} is not set`);
  const derived = (Object.keys(ROLE_OF) as PartyName[]).map((p) =>
    [p, deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles[ROLE_OF[p]]))] as const);

  const electrum = new ElectrumNetworkProvider(Network.MAINNET,
    { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
  const raw = electrum as unknown as NetworkProvider;
  await electrum.connect();
  const provider = gateProvider(raw, {
    ledgerFile: join(repoRoot, cfg.mainnet.ledgerFile), budgetSats: cfg.mainnet.budgetSats, note: 'demo escrow staging',
    walletLocks: new Set(derived.map(([, k]) => binToHex(lockOf(k.address)))),
  });
  const parties = Object.fromEntries(derived.map(([p, k]) => [p, party(k.privateKey, provider)])) as
    Record<PartyName, Party>;
  const seller = parties.seller;

  // Staging pays from the seller address only: bring the other role addresses' plain coins there first.
  let held = await satsAt(raw, seller.address);
  if (held < need) {
    const { txid } = await gather(provider, parties, {}, cfg.mainnet.feeRateSatsPerByte);
    if (txid) console.log(`gathered the wallet's plain coins at the seller: ${txid}`);
    held = await satsAt(raw, seller.address);
  }
  console.log(`seller ${seller.address} holds ${held} sat; staging needs ${need} (${server.hostname})`);
  if (held < need) {
    await electrum.disconnect();
    throw new FundsShort(`not funded: the wallet holds ${held} sat at the seller, staging needs ${need}; nothing staged`);
  }

  const payDemo: Pay = async (address, amounts) => {
    const txid = await pay(provider, seller, amounts.map((amount) => ({ to: lockOf(address), amount })),
      cfg.mainnet.feeRateSatsPerByte);
    return amounts.map((satoshis, vout): Utxo => ({ txid, vout, satoshis }));
  };
  return { provider, raw, electrum, pay: payDemo, returnAddress: seller.address, node: server.hostname };
}
