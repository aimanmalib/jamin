// Turns a regtest lifecycle run (state/regtest/run-*.json, written by scripts/lifecycle.ts) into
// examples/regtest.json, the recorded run the web app shows. Refuses a run with a failed branch. With --refused, the
// run is one of branch R and only the file's `refused` escrow is replaced (decision 0015).
//   npx tsx scripts/regtest-example.ts state/regtest/run-<time>.json
//   npx tsx scripts/regtest-example.ts --refused state/regtest/run-<time>.json
import { readFileSync, writeFileSync } from 'node:fs';
import { refusedExample, regtestExample, type RegtestExample, type RegtestRunFile } from '../src/lifecycle/example.js';

const OUT = 'examples/regtest.json';
const refusedOnly = process.argv[2] === '--refused';
const file = process.argv[refusedOnly ? 3 : 2];
if (!file) {
  console.error('usage: tsx scripts/regtest-example.ts [--refused] <state/regtest/run-*.json>');
  process.exit(2);
}
const run = JSON.parse(readFileSync(file, 'utf8')) as RegtestRunFile;
const current = JSON.parse(readFileSync(OUT, 'utf8')) as RegtestExample;
const example: RegtestExample = refusedOnly ? { ...current, refused: refusedExample(run) }
  : { ...regtestExample(run), ...(current.refused ? { refused: current.refused } : {}) };
writeFileSync(OUT, `${JSON.stringify(example, null, 2)}\n`);
console.log(`${OUT}: ${example.transactions.length} transactions from ${example.node}; refused attempts: ${
  example.refused?.steps.filter((s) => 'refused' in s).length ?? 0}`);
