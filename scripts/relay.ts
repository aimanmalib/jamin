// Relays a transaction a party signed (docs/decisions/0019-keyless-relayer.md). Reads the signed transaction hex
// and the intent JSON the party wrote next to it, checks one against the other, and prints the result. With --send
// the unchanged bytes go to the configured mainnet server through the spending gate, so the ledger still counts any
// test wallet coin the transaction spends; the wallet's public locking scripts are derived for that count only and
// nothing is signed. Prints txids and reasons only.
//   npx tsx scripts/relay.ts <tx.hex> <intent.json> [--send]
// Exit codes: 0 checked or sent, 1 refused or failed, 2 bad arguments, host not allowed or no phrase.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, hashTransaction, hexToBin } from '@bitauth/libauth';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { loadConfig, repoRoot } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { lockOf } from '../src/lifecycle/context.js';
import { RelayRefused, checkRelay, relay, type RelayIntent } from '../src/relay/relay.js';
import { readEnvValue } from '../src/wallet/env-file.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';

const args = process.argv.slice(2);
const send = args.includes('--send');
const [txFile, intentFile] = args.filter((a) => !a.startsWith('--'));
if (!txFile || !intentFile) {
  console.error('usage: tsx scripts/relay.ts <tx.hex> <intent.json> [--send]');
  process.exit(2);
}
const hex = readFileSync(txFile, 'utf8').trim();
const intent = JSON.parse(readFileSync(intentFile, 'utf8')) as RelayIntent;
const reasons = checkRelay(hex, intent);
if (reasons.length > 0) {
  console.error(`refused: ${reasons.join('; ')}`);
  process.exit(1);
}
console.log(`matches the intent: txid ${hashTransaction(hexToBin(hex))}, ${intent.outputs.length} outputs`);
if (!send) {
  console.log('dry run: nothing broadcast (add --send)');
  process.exit(0);
}

const cfg = loadConfig();
const server = cfg.electrum.mainnet;
if (!cfg.mainnet.broadcastHosts.includes(server.hostname)) {
  console.error(`refused: ${server.hostname} is not in mainnet.broadcastHosts`);
  process.exit(2);
}
const phrase = process.env[cfg.wallet.mnemonicEnv] ?? readEnvValue(join(repoRoot, cfg.wallet.envFile), cfg.wallet.mnemonicEnv);
if (!phrase) { console.error(`${cfg.wallet.mnemonicEnv} is not set`); process.exit(2); }
const walletLocks = new Set(Object.values(cfg.wallet.roles)
  .map((i) => binToHex(lockOf(deriveKey(phrase, childPath(cfg.wallet.derivationBase, i)).address))));

const electrum = new ElectrumNetworkProvider(Network.MAINNET,
  { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
const gated = gateProvider(electrum as unknown as NetworkProvider, {
  ledgerFile: join(repoRoot, cfg.mainnet.ledgerFile), budgetSats: cfg.mainnet.budgetSats, note: 'relay', walletLocks,
});
let code = 0;
await electrum.connect();
try {
  console.log(`sent ${await relay(hex, intent, (h) => gated.sendRawTransaction(h))}`);
} catch (e) {
  console.error(`${e instanceof RelayRefused ? '' : 'FAILED '}${(e as Error).message.slice(0, 400)}`);
  code = 1;
} finally {
  await electrum.disconnect();
}
process.exit(code);
