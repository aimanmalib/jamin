// Read only on the network: gives each fund/deposit step of examples/mainnet.json the amount it locked, read from the
// transaction on the configured Electrum server (src/lifecycle/locked.ts). Broadcasts nothing, needs no wallet.
// Usage: npx tsx scripts/record-locked.ts
import { join } from 'node:path';
import { ElectrumClient } from '@electrum-cash/network';
import { loadConfig, repoRoot } from '../src/config.js';
import { readRecord, writeRecord } from '../src/lifecycle/record.js';
import { lockedOf, unlockedTxids, withLocked, type Locked, type VerboseOutput } from '../src/lifecycle/locked.js';

const cfg = loadConfig();
const file = join(repoRoot, cfg.mainnetExamples);
const record = readRecord(file);
const asset = new Map(record.escrows.flatMap((e) => e.steps.flatMap((s) => ('txid' in s ? [[s.txid, e.asset]] : []))));
const s = cfg.electrum.mainnet;
const client = new ElectrumClient('jamin', '1.5.3', s.hostname,
  { port: s.port, encrypted: s.scheme === 'wss', timeoutInMilliSeconds: s.timeoutMs });
await client.connect();
const amounts = new Map<string, Locked>();
try {
  for (const txid of unlockedTxids(record)) {
    const tx = await client.request('blockchain.transaction.get', txid, true);
    if (tx instanceof Error) throw tx;
    const locked = lockedOf((tx as { vout: VerboseOutput[] }).vout, asset.get(txid) ?? 'BCH', cfg.tokens.pusd.category);
    amounts.set(txid, locked);
    console.log(`${txid} ${JSON.stringify(locked)}`);
  }
} finally {
  await client.disconnect(true);
}
writeRecord(file, withLocked(record, amounts));
console.log(`${amounts.size} locking steps recorded in ${cfg.mainnetExamples}`);
