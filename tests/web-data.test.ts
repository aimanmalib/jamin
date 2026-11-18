// Data the web app shows: the feature table parsed from docs/FEATURES.md points at real contract lines, the regtest
// record matches docs/MEASURED.md, Electrum coin summaries, and hash routes.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFeatures } from '../web/data/features.js';
import { summarise } from '../web/net/utxos.js';
import { tabFromHash, hrefOf } from '../web/route.js';
import regtest from '../examples/regtest.json' with { type: 'json' };
import mainnet from '../examples/mainnet.json' with { type: 'json' };

describe('feature table', () => {
  const features = parseFeatures(readFileSync('docs/FEATURES.md', 'utf8'));

  it('reads every numbered row with at least one code reference', () => {
    expect(features.length).toBeGreaterThanOrEqual(12);
    expect(features.map((f) => f.n)).toEqual(features.map((_, i) => i + 1));
    for (const f of features) expect(f.refs.length + f.code.length, f.name).toBeGreaterThan(0);
    expect(features.filter((f) => f.refs.length > 0).length).toBeGreaterThanOrEqual(12);
  });

  it('keeps SDK references outside contracts/ as text, not as contract source links', () => {
    const rows = parseFeatures('| 1 | SDK | `src/a.ts:3`, `contracts/B.scash:2` | t |\n| 2 | Lang | `contracts/C.scash:9` | t |');
    expect(rows.map((r) => [r.refs, r.code])).toEqual([[[{ file: 'B.scash', line: 2 }], ['src/a.ts:3']],
      [[{ file: 'C.scash', line: 9 }], []]]);
  });

  it('points every reference at an existing line of a contract file', () => {
    for (const ref of features.flatMap((f) => f.refs)) {
      const path = `contracts/${ref.file}`;
      expect(existsSync(path), path).toBe(true);
      expect(ref.line).toBeLessThanOrEqual(readFileSync(path, 'utf8').split('\n').length);
    }
  });
});

describe('recorded runs', () => {
  it('has every regtest txid of docs/MEASURED.md, with the same height', () => {
    const measured = readFileSync('docs/MEASURED.md', 'utf8');
    const section = measured.slice(measured.indexOf('## Regtest (real consensus limits)'));
    const rows = [...section.matchAll(/\| ([A-E]) \| (\w+) \| `([0-9a-f]{64})` \| (\d+) \|/g)];
    expect(rows.map((m) => [m[1], m[2], m[3], Number(m[4])]))
      .toEqual(regtest.transactions.map((t) => [t.branch, t.step, t.txid, t.height]));
    for (const t of regtest.transactions) expect(t.largestUnlockBytes).toBeLessThanOrEqual(regtest.unlockLimitBytes);
  });

  it('keeps the mainnet record in the shape the page reads', () => {
    expect(Array.isArray(mainnet.escrows)).toBe(true);
  });
});

describe('Electrum coin summary', () => {
  it('counts coins, satoshis and token coins', () => {
    expect(summarise([{ value: 1000 }, { value: 546, token_data: { amount: '1' } }]))
      .toEqual({ count: 2, sats: 1546, tokenCoins: 1 });
    expect(summarise([])).toEqual({ count: 0, sats: 0, tokenCoins: 0 });
  });
});

describe('hash routes', () => {
  it('maps hashes to tabs and back', () => {
    expect(tabFromHash('#/try')).toBe('try');
    expect(tabFromHash('#/contract/x')).toBe('contract');
    expect(tabFromHash('')).toBe('home');
    expect(tabFromHash('#/nope')).toBe('home');
    expect(hrefOf('home')).toBe('#/');
    expect(hrefOf('lifecycle')).toBe('#/lifecycle');
  });
});
