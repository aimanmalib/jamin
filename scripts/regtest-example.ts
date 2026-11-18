// Turns a regtest lifecycle run (state/regtest/run-*.json, written by scripts/lifecycle.ts) into
// examples/regtest.json, the recorded run the web app shows. Refuses a run with a failed branch.
//   npx tsx scripts/regtest-example.ts state/regtest/run-<time>.json
import { readFileSync, writeFileSync } from 'node:fs';
import { regtestExample, type RegtestRunFile } from '../src/lifecycle/example.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: tsx scripts/regtest-example.ts <state/regtest/run-*.json>');
  process.exit(2);
}
const run = JSON.parse(readFileSync(file, 'utf8')) as RegtestRunFile;
const example = regtestExample(run);
writeFileSync('examples/regtest.json', `${JSON.stringify(example, null, 2)}\n`);
console.log(`examples/regtest.json: ${example.transactions.length} transactions from ${example.node}`);
