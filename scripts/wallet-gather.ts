// `npm run wallet -- gather`: one wallet-internal payment that moves the spare plain coins of the other role addresses
// to the seller (decision 0016). It broadcasts only through a host in mainnet.broadcastHosts and only behind the
// spending gate, and prints addresses, amounts and the txid; never the phrase or a key.
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { loadConfig, repoRoot } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { lockOf, party, satsAt, type Party, type PartyName } from '../src/lifecycle/context.js';
import { gather } from '../src/wallet/gather.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';
import { ROLE_OF } from './lifecycle-mainnet.js';

export async function gatherToSeller(phrase: string): Promise<number> {
  const cfg = loadConfig();
  const server = cfg.electrum.mainnet;
  if (!cfg.mainnet.broadcastHosts.includes(server.hostname)) {
    console.error(`refused: ${server.hostname} is not in mainnet.broadcastHosts`);
    return 2;
  }
  const keys = (Object.keys(ROLE_OF) as PartyName[]).map((p) =>
    [p, deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles[ROLE_OF[p]]))] as const);
  const electrum = new ElectrumNetworkProvider(Network.MAINNET,
    { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
  const raw = electrum as unknown as NetworkProvider;
  await electrum.connect();
  try {
    const provider = gateProvider(raw, {
      ledgerFile: join(repoRoot, cfg.mainnet.ledgerFile), budgetSats: cfg.mainnet.budgetSats, note: 'wallet gather',
      walletLocks: new Set(keys.map(([, k]) => binToHex(lockOf(k.address)))),
    });
    const parties = Object.fromEntries(keys.map(([p, k]) => [p, party(k.privateKey, provider)])) as
      Record<PartyName, Party>;
    // The buyer and the arbitrator keep what stops a run from topping them up again (src/lifecycle/mainnet.ts).
    const floor = BigInt(cfg.mainnet.partyFloatSats) / 2n;
    const before = await satsAt(raw, parties.seller.address);
    const { txid, plan } = await gather(provider, parties, { buyer: floor, arbitrator: floor },
      cfg.mainnet.feeRateSatsPerByte);
    if (!txid) { console.log(`nothing to gather; seller holds ${before} sat`); return 0; }
    for (const i of plan.inputs) console.log(`from ${i.name} ${parties[i.name].address}`);
    console.log(`gathered ${txid}: seller ${parties.seller.address} ${before} -> ${await satsAt(raw, parties.seller.address)} sat`);
    return 0;
  } finally {
    await electrum.disconnect();
  }
}
