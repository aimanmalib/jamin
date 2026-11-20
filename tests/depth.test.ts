// The Home depth strip (decision 0026): every number web/data/depth.ts gives is counted again here another way from
// the same files, so a number typed by hand, or a file that changed without the strip, turns this red.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mainnetRaw from '../examples/mainnet.json' with { type: 'json' };
import config from '../config/jamin.json' with { type: 'json' };
import testCases from '../artifacts/solidhat-tests.json' with { type: 'json' };
import { countFindings, depth, mainnetDepth, txidsIn } from '../web/data/depth.js';
import type { MainnetRun } from '../web/data/examples.js';

const run = mainnetRaw as unknown as MainnetRun;
const featuresMd = readFileSync('docs/FEATURES.md', 'utf8');
const findingsMd = readFileSync('docs/SOLIDCASH-FINDINGS.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const measured = readFileSync('docs/MEASURED.md', 'utf8');
const site = depth({ featuresMd, findingsMd, testCases, upstreamPrs: config.depth.upstreamPrs, run });
const testFiles = readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`).sort();

describe('depth numbers, counted another way', () => {
  it('features: table rows of docs/FEATURES.md that start with a number', () => {
    expect(site.features).toBe(featuresMd.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).length);
    expect(site.features).toBeGreaterThan(0);
  });

  it('findings: lines that start with "## F" and a number, each number once', () => {
    const ids = featuresOf(findingsMd);
    expect(site.findings).toBe(ids.size);
    expect([...ids].map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: ids.size }, (_, i) => i + 1));
  });

  it('upstream pull requests: each listed in the README section as its own bullet, nothing else listed there', () => {
    const section = readme.slice(readme.indexOf('\n## Upstream contributions\n'), readme.indexOf('\n## Known limits\n'));
    const bullets = [...section.matchAll(/^- \[solidcash\/solidcash#(\d+)\]\((\S+)\)/gm)];
    expect(bullets.map((m) => Number(m[1])).sort((a, b) => a - b)).toEqual([...config.depth.upstreamPrs].sort((a, b) => a - b));
    for (const m of bullets) expect(m[2]).toBe(config.depth.upstreamPrUrl.replace('{n}', m[1] ?? ''));
    for (const n of config.depth.upstreamPrs) expect(findingsMd).toContain(config.depth.upstreamPrUrl.replace('{n}', String(n)));
    expect(site.upstreamPrs).toBe(bullets.length);
  });

  it('scenarios and transactions: branch labels and 64-hex txids of the escrows that are not demo pool escrows', () => {
    const runs = (mainnetRaw.escrows as { branch: string; demo?: boolean }[]).filter((e) => e.demo !== true);
    const txids = new Set([...JSON.stringify(runs).matchAll(/"txid":"([0-9a-f]{64})"/g)].map((m) => m[1]));
    expect(site.scenarios).toBe(new Set(runs.map((e) => e.branch)).size);
    expect(site.transactions).toBe(txids.size);
    expect(site.transactions).toBeGreaterThan(site.scenarios);
  });

  it('follows the file: one more scenario with one new and one repeated txid', () => {
    const one = run.escrows[0]?.steps[0] as { txid: string };
    const more: MainnetRun = { escrows: [...run.escrows, { branch: 'Z', asset: 'BCH', steps: [
      { step: 'fund', txid: 'ff'.repeat(32) }, { step: 'release', txid: one.txid },
    ] } as never] };
    expect(mainnetDepth(more)).toEqual({ scenarios: site.scenarios + 1, transactions: site.transactions + 1 });
    expect(mainnetDepth({ escrows: [...run.escrows, { ...more.escrows.at(-1), demo: true } as never] }))
      .toEqual({ scenarios: site.scenarios, transactions: site.transactions });
  });

  it('txidsIn walks nested values and ignores other keys', () => {
    expect([...txidsIn({ a: [{ txid: 'x' }, { b: { txid: 'y', rawTxHash: 'z' } }], txid: 'x' })].sort()).toEqual(['x', 'y']);
    expect(countFindings('## F1 a\n## F2 b\n### F3 c\n## F2 again\n')).toBe(2);
  });
});

describe('SolidHat test list', () => {
  it('names every test file in test/ and no other file', () => {
    expect([...new Set(testCases.map((c) => c.file))].sort()).toEqual(testFiles);
  });

  it('holds every test written with a plain title, and at least one case per it/test call', () => {
    let calls = 0;
    for (const file of testFiles) {
      const src = readFileSync(file, 'utf8');
      calls += [...src.matchAll(/\b(?:it|test)\(/g)].length;
      const names = testCases.filter((c) => c.file === file).map((c) => c.name);
      for (const m of src.matchAll(/\b(?:it|test)\('((?:[^'\\]|\\.)*)'/g)) {
        const title = (m[1] ?? '').replace(/\\'/g, "'");
        expect(names.some((n) => n.endsWith(` > ${title}`)), `${file}: ${title}`).toBe(true);
      }
    }
    expect(testCases.length).toBeGreaterThanOrEqual(calls);
  });

  it('agrees with the README and the latest count in docs/MEASURED.md', () => {
    const record = measured.slice(measured.indexOf('\n## Test count\n')).split('\n## ')[1] ?? '';
    expect(/`solidhat test` \d+\s+files, (\d+) tests/.exec(record)?.[1]).toBe(String(site.tests));
    const stated = [...readme.matchAll(/(\d+) SolidHat tests|SolidHat tests \((\d+)/g)].map((m) => m[1] ?? m[2]);
    expect(stated.length).toBeGreaterThan(0);
    for (const n of stated) expect(n).toBe(String(site.tests));
  });
});

describe('the strip itself', () => {
  it('writes no number of its own: no digit literals in the component or the counting module', () => {
    for (const f of ['web/ui/DepthStrip.tsx', 'web/data/depth.ts']) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*\*.*?\*\//gs, '');
      expect(src.match(/(?<![\w.#[])\d+(?![\w])/g) ?? [], f).toEqual([]);
    }
  });

  it('links the porting note, and the document exists', () => {
    expect(config.depth.links.porting).toMatch(/docs\/PORTING\.md$/);
    expect(readFileSync('docs/PORTING.md', 'utf8')).toMatch(/OpenPeerEscrow/);
  });
});

function featuresOf(md: string): Set<string> {
  return new Set(md.split('\n').filter((l) => l.startsWith('## F')).map((l) => /^## F(\d+)/.exec(l)?.[1])
    .filter((x): x is string => x !== undefined));
}
