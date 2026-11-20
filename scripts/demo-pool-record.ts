// Read only on the network: copies the demo pool's staged escrows (decision 0021) from the pool ledger into
// examples/mainnet.json as branch P, marked `demo`, with each step's size, miner fee and block height read from the
// configured Electrum server. Broadcasts nothing, needs no wallet. Then run record-locked.ts for the locked amounts.
// A step still in the mempool is refused: run again after it is mined.
// Usage: npx tsx scripts/demo-pool-record.ts [ledger file, default state/demo-pool.json]
import { join } from 'node:path';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { loadConfig, repoRoot } from '../src/config.js';
import { readLedger } from '../src/demo/pool.js';
import { addDemoEscrow, unrecordedPool } from '../src/demo/record.js';
import { measure } from '../src/lifecycle/inspect.js';
import { readRecord, writeRecord, type MainnetStep } from '../src/lifecycle/record.js';

const cfg = loadConfig();
const ledger = readLedger(process.argv[2] ?? join(repoRoot, 'state/demo-pool.json'));
const recordFile = join(repoRoot, cfg.mainnetExamples);
let record = readRecord(recordFile);
const todo = unrecordedPool(record, ledger.escrows);
const server = cfg.electrum.mainnet;
const electrum = new ElectrumNetworkProvider(Network.MAINNET,
  { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
await electrum.connect();
const read = electrum as unknown as NetworkProvider;
const tip = await read.getBlockHeight();
try {
  for (const e of todo) {
    const rows: MainnetStep[] = [];
    for (const st of e.steps) {
      const m = await measure(read, { branch: 'P', step: st.step, txid: st.txid });
      const v = await electrum.performRequest('blockchain.transaction.get', st.txid, true) as { confirmations?: number };
      if (!v.confirmations) throw new Error(`${st.txid} is not in a block yet; run again later`);
      rows.push({ step: st.step, txid: st.txid, height: tip - v.confirmations + 1, txBytes: m.txBytes,
        ...(m.feeSats === undefined ? {} : { feeSats: m.feeSats }) });
    }
    record = addDemoEscrow(record, e.address, rows);
    console.log(`${e.address}: ${rows.map((r) => `${r.step} ${r.txBytes} B h ${r.height} fee ${r.feeSats ?? '?'}`).join(', ')}`);
  }
} finally {
  await electrum.disconnect();
}
writeRecord(recordFile, record);
console.log(`${todo.length} pool escrows recorded in ${cfg.mainnetExamples}`);
