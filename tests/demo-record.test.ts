// The mainnet demo escrow's record (decision 0020): staging appends it to examples/mainnet.json as branch P, marked
// `demo`, the site's card acts on the latest one, and the wallet must hold what staging pays before it starts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MainnetRecord } from '../src/lifecycle/record.js';
import { addDemoEscrow, latestDemo, unrecordedPool } from '../src/demo/record.js';
import { demoEscrowAddress } from '../web/data/examples.js';
import { stagingNeed } from '../scripts/demo-mainnet.js';

const tx = (n: number): string => n.toString(16).padStart(64, '0');
const steps = (from: number) => ['createEscrow', 'fund', 'markAsPaid'].map((step, i) => ({ step, txid: tx(from + i) }));
const BASE: MainnetRecord = { network: 'mainnet', escrows: [
  { branch: 'A', asset: 'BCH', address: 'bitcoincash:pa', steps: [{ step: 'createEscrow', txid: tx(1) }] },
] };

describe('demo escrow record', () => {
  it('appends the staged escrow as branch P, marked demo, after the others', () => {
    const r = addDemoEscrow(BASE, 'bitcoincash:pp', steps(10));
    expect(r.escrows).toHaveLength(2);
    expect(r.escrows[1]).toEqual({ branch: 'P', asset: 'BCH', address: 'bitcoincash:pp', demo: true, steps: steps(10) });
    expect(BASE.escrows).toHaveLength(1);
  });

  it('refuses an address or a txid already recorded, and a record not starting at createEscrow', () => {
    const once = addDemoEscrow(BASE, 'bitcoincash:pp', steps(10));
    expect(() => addDemoEscrow(once, 'bitcoincash:pp', steps(20))).toThrow(/already recorded/);
    expect(() => addDemoEscrow(once, 'bitcoincash:pq', steps(11))).toThrow(/already recorded/);
    expect(() => addDemoEscrow(BASE, 'bitcoincash:pq', steps(20).slice(1))).toThrow(/starts with createEscrow/);
  });

  it('acts on the latest demo escrow when one was staged again', () => {
    const twice = addDemoEscrow(addDemoEscrow(BASE, 'bitcoincash:pp', steps(10)), 'bitcoincash:pq', steps(20));
    expect(latestDemo(twice)?.address).toBe('bitcoincash:pq');
    expect(demoEscrowAddress(twice)).toBe('bitcoincash:pq');
    expect(latestDemo(BASE)).toBeUndefined();
  });

  it('copies only the pool escrows the record does not hold yet, oldest first', () => {
    const once = addDemoEscrow(BASE, 'bitcoincash:pp', steps(10));
    const pool = [{ address: 'bitcoincash:pp' }, { address: 'bitcoincash:pq' }, { address: 'bitcoincash:pr' }];
    expect(unrecordedPool(once, pool).map((e) => e.address)).toEqual(['bitcoincash:pq', 'bitcoincash:pr']);
    expect(unrecordedPool(once, [])).toEqual([]);
  });

  it('needs the seller and buyer coins plus a fee margin each at the seller before staging', () => {
    expect(stagingNeed({ sellerCoinSats: 30_000, buyerCoinSats: 10_000 })).toBe(46_000n);
  });
});

describe('examples/mainnet.json', () => {
  const record = JSON.parse(readFileSync('examples/mainnet.json', 'utf8')) as MainnetRecord;
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')) as { lifecycle: { branch: Record<string, string> } };
  const ms = JSON.parse(readFileSync('lang/ms.json', 'utf8')) as { lifecycle: { branch: Record<string, string> } };

  it('names every recorded branch in both languages', () => {
    for (const e of record.escrows) {
      expect(en.lifecycle.branch[e.branch], e.branch).toBeTruthy();
      expect(ms.lifecycle.branch[e.branch], e.branch).toBeTruthy();
    }
  });

  it('records each demo escrow as staged: createEscrow, fund, markAsPaid, then at most a release', () => {
    for (const e of record.escrows.filter((x) => x.demo === true)) {
      expect(e.branch).toBe('P');
      expect(e.steps.slice(0, 3).map((s) => s.step)).toEqual(['createEscrow', 'fund', 'markAsPaid']);
      expect(e.steps.slice(3).every((s) => s.step === 'release')).toBe(true);
    }
  });

  it('holds the demo pool on mainnet: at least three demo escrows, each step with a block height', () => {
    const demos = record.escrows.filter((x) => x.demo === true);
    expect(demos.length).toBeGreaterThanOrEqual(3);
    for (const e of demos) for (const s of e.steps) expect('height' in s && typeof s.height === 'number', e.address).toBe(true);
  });
});
