// Read only on the network: copies the demo pool's staged escrows (decision 0021) from the pool ledger into
// examples/mainnet.json as branch P, marked `demo`, with each step's size, miner fee and block height read from the
// configured Electrum server. Broadcasts nothing, needs no wallet. Then run record-locked.ts for the locked amounts.
// A step still in the mempool is refused: run again after it is mined.
// With --release <escrow address> <txid> it adds instead a visitor's release of a recorded demo escrow.
// Usage: npx tsx scripts/demo-pool-record.ts [ledger file, default state/demo-pool.json]
//        npx tsx scripts/demo-pool-record.ts --release <escrow address> <txid>
import { join } from 'node:path';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { loadConfig, repoRoot } from '../src/config.js';
import { readLedger } from '../src/demo/pool.js';
import { addDemoEscrow, addDemoRelease, unrecordedPool } from '../src/demo/record.js';
import { measure } from '../src/lifecycle/inspect.js';
import { readRecord, writeRecord, type MainnetStep } from '../src/lifecycle/record.js';

const cfg = loadConfig();
const args = process.argv.slice(2);
const released = args[0] === '--release' ? { address: args[1] ?? '', txid: args[2] ?? '' } : undefined;
if (released && !/^[0-9a-f]{64}$/.test(released.txid)) throw new Error('usage: --release <escrow address> <txid>');
const recordFile = join(repoRoot, cfg.mainnetExamples);
let record = readRecord(recordFile);
const todo = released ? [] : unrecordedPool(record, readLedger(args[0] ?? join(repoRoot, 'state/demo-pool.json')).escrows);
const server = cfg.electrum.mainnet;
const electrum = new ElectrumNetworkProvider(Network.MAINNET,
  { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
await electrum.connect();
const read = electrum as unknown as NetworkProvider;
const tip = await read.getBlockHeight();
const row = async (step: string, txid: string): Promise<MainnetStep> => {
  const m = await measure(read, { branch: 'P', step, txid });
  const v = await electrum.performRequest('blockchain.transaction.get', txid, true) as { confirmations?: number };
  if (!v.confirmations) throw new Error(`${txid} is not in a block yet; run again later`);
  return { step, txid, height: tip - v.confirmations + 1, txBytes: m.txBytes,
    ...(m.feeSats === undefined ? {} : { feeSats: m.feeSats }) };
};
try {
  if (released) {
    const r = await row('release', released.txid);
    record = addDemoRelease(record, released.address, r);
    console.log(`${released.address}: release ${r.txBytes} B h ${r.height} fee ${r.feeSats ?? '?'}`);
  }
  for (const e of todo) {
    const rows: MainnetStep[] = [];
    for (const st of e.steps) rows.push(await row(st.step, st.txid));
    record = addDemoEscrow(record, e.address, rows);
    console.log(`${e.address}: ${rows.map((r) => `${r.step} ${r.txBytes} B h ${r.height} fee ${r.feeSats ?? '?'}`).join(', ')}`);
  }
} finally {
  await electrum.disconnect();
}
writeRecord(recordFile, record);
console.log(released ? `release recorded in ${cfg.mainnetExamples}` : `${todo.length} pool escrows recorded in ${cfg.mainnetExamples}`);
