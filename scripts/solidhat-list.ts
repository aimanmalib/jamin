// Writes artifacts/solidhat-tests.json: every SolidHat test case `npm run solidhat:test` runs, collected by running
// the test files (not by reading them, so cases made in loops count). The Home depth strip counts this file.
// Usage: npx tsx scripts/solidhat-list.ts          write the file
//        npx tsx scripts/solidhat-list.ts --check  exit 1 when the file differs from the test files (the gate runs this)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { repoRoot } from '../src/config.js';

const OUT = join(repoRoot, 'artifacts', 'solidhat-tests.json');
interface Listed { name: string; file: string }
/** Code point order, so the file is the same on every machine whatever its locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const dir = mkdtempSync(join(tmpdir(), 'jamin-list-'));
let cases: Listed[];
try {
  const json = join(dir, 'list.json');
  execFileSync(join(repoRoot, 'node_modules', '.bin', 'vitest'),
    ['list', '--config', 'vitest.solidhat.config.ts', '--staticParse=false', `--json=${json}`],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  cases = (JSON.parse(readFileSync(json, 'utf8')) as Listed[])
    .map((c) => ({ file: relative(repoRoot, c.file), name: c.name }))
    .sort((a, b) => cmp(a.file, b.file) || cmp(a.name, b.name));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const text = `${JSON.stringify(cases, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== text) {
    console.error(`artifacts/solidhat-tests.json is out of date (${cases.length} cases collected). ` +
      'Run: npx tsx scripts/solidhat-list.ts');
    process.exit(1);
  }
  console.log(`artifacts/solidhat-tests.json matches: ${cases.length} cases`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote artifacts/solidhat-tests.json: ${cases.length} cases`);
}
