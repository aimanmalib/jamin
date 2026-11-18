// Buys the token units branch B needs on mainnet from Cauldron pools (docs/decisions/0012), into the seller address
// of the project's test wallet. Without --send it only prints the quote. With --send the transaction goes through
// the spending gate (src/budget/gate.ts) and only to a configured broadcast host. Prints public data only.
//   npx tsx scripts/buy-token.ts [--send]
// Exit codes: 0 done or nothing to buy, 1 refused or failed, 2 host not allowed or no phrase.
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import ExchangeLab from '@cashlab/cauldron/exchange-lab.js';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { loadConfig, repoRoot } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { readLedger, totalSpent } from '../src/budget/ledger.js';
import { tradeFee } from '../src/lifecycle/branches.js';
import { lockOf } from '../src/lifecycle/context.js';
import { buildPurchase, poolsFromIndexer, verifiedPools } from '../src/swap/cauldron.js';
import { readEnvValue } from '../src/wallet/env-file.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';

const cfg = loadConfig();
const send = process.argv.includes('--send');
const server = cfg.electrum.mainnet;
if (!cfg.mainnet.broadcastHosts.includes(server.hostname)) {
  console.error(`refused: ${server.hostname} is not in mainnet.broadcastHosts`);
  process.exit(2);
}
const phrase = process.env[cfg.wallet.mnemonicEnv] ?? readEnvValue(join(repoRoot, cfg.wallet.envFile), cfg.wallet.mnemonicEnv);
if (!phrase) { console.error(`${cfg.wallet.mnemonicEnv} is not set`); process.exit(2); }

const all = Object.values(cfg.wallet.roles).map((i) => deriveKey(phrase, childPath(cfg.wallet.derivationBase, i)));
const seller = deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles.seller));
const { category } = cfg.tokens.pusd;
const p = cfg.mainnet.tokenPurchase;
const amount = BigInt(cfg.mainnet.tokenAmount);
// What branch B deposits: amount + fee, plus the unit that stays in the token container.
const wanted = amount + tradeFee(amount, BigInt(cfg.escrow.feeBps), 1n) + 1n;

const electrum = new ElectrumNetworkProvider(Network.MAINNET,
  { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
const raw = electrum as unknown as NetworkProvider;
await electrum.connect();
let code = 0;
try {
  const coins = await raw.getUtxos(seller.address);
  const held = coins.filter((u) => u.token?.category === category && !u.token.nft)
    .reduce((a, u) => a + (u.token?.amount ?? 0n), 0n);
  const units = wanted - held;
  console.log(`seller ${seller.address}: holds ${held} units, branch B deposits ${wanted}`);
  if (units <= 0n) {
    console.log('nothing to buy');
  } else if (units > BigInt(p.maxUnits)) {
    console.error(`refused: ${units} units is more than tokenPurchase.maxUnits (${p.maxUnits})`);
    code = 1;
  } else {
    const res = await fetch(p.indexerUrl.replace('{category}', category), { signal: AbortSignal.timeout(server.timeoutMs) });
    if (!res.ok) throw new Error(`indexer answered HTTP ${res.status}`);
    const indexed = poolsFromIndexer(await res.json(), category);
    const exlab = new ExchangeLab();
    const pools = await verifiedPools(exlab, indexed, (txid) => raw.getRawTransaction(txid));
    console.log(`pools: ${indexed.length} listed, ${pools.length} match the chain`);
    const buy = buildPurchase(exlab, { pools, category, units, coins, privateKey: seller.privateKey,
      lock: lockOf(seller.address), feeRate: BigInt(cfg.mainnet.feeRateSatsPerByte), maxSupplySats: BigInt(p.maxSupplySats) });
    console.log(`quote: ${buy.units} units for ${buy.supplySats} sat (trade fee ${buy.tradeFeeSats}), miner fee ` +
      `${buy.minerFeeSats} sat, tx ${buy.txHex.length / 2} B, txid ${buy.txid}`);
    if (send) {
      const ledgerFile = join(repoRoot, cfg.mainnet.ledgerFile);
      const gated = gateProvider(raw, { ledgerFile, budgetSats: cfg.mainnet.budgetSats, note: 'cauldron token purchase',
        walletLocks: new Set(all.map((k) => binToHex(lockOf(k.address)))) });
      const txid = await gated.sendRawTransaction(buy.txHex);
      console.log(`sent ${txid}; ledger ${totalSpent(readLedger(ledgerFile))} of ${cfg.mainnet.budgetSats} sat`);
    } else {
      console.log('dry run: nothing broadcast (add --send)');
    }
  }
} catch (e) {
  console.error(`FAILED ${(e as Error).message.slice(0, 400)}`);
  code = 1;
} finally {
  await electrum.disconnect();
}
process.exit(code);
