// examples/regtest.json is made from a regtest run file, and only from a run where every branch passed.
import { describe, expect, it } from 'vitest';
import { nodeName, refusedExample, regtestExample, type RegtestRunFile } from '../src/lifecycle/example.js';

const step = { branch: 'E', step: 'resolveDispute', txid: 'ab'.repeat(32), txBytes: 7665, inputs: 8,
  maxUnlockingBytes: 5498, height: 258 };
const run: RegtestRunFile = { network: 'regtest', node: '/Bitcoin Cash Node:29.0.0(EB32.0)/',
  at: '2026-11-18T05:03:37.074Z', failures: [], steps: [step] };

describe('regtestExample', () => {
  it('keeps each step with its height and largest unlocking script', () => {
    expect(regtestExample(run)).toEqual({
      network: 'regtest', node: 'Bitcoin Cash Node 29.0.0', measuredAt: '2026-11-18T05:03:00Z',
      source: 'docs/MEASURED.md#regtest-real-consensus-limits', unlockLimitBytes: 10_000,
      transactions: [{ branch: 'E', step: 'resolveDispute', txid: 'ab'.repeat(32), height: 258, txBytes: 7665,
        inputs: 8, largestUnlockBytes: 5498 }],
    });
  });

  it('keeps the miner fee when the run measured it', () => {
    const withFee = regtestExample({ ...run, steps: [{ ...step, feeSats: 7_700 }] });
    expect(withFee.transactions[0]?.feeSats).toBe(7_700);
  });

  it('refuses a run with a failed branch, an unmined step or another network', () => {
    expect(() => regtestExample({ ...run, failures: ['D: TooEarly'] })).toThrow(/failed branches/);
    expect(() => regtestExample({ ...run, steps: [{ ...step, height: null }] })).toThrow(/not mined/);
    expect(() => regtestExample({ ...run, network: 'mainnet' })).toThrow(/not a regtest run/);
  });

  it('leaves an unknown node string as it is', () => {
    expect(nodeName('custom')).toBe('custom');
  });
});

describe('refusedExample', () => {
  const tx = (n: number): string => n.toString(16).padStart(64, '0');
  const r = (n: number, height: number, stepName: string, escrow?: string) => ({ branch: 'R', step: stepName, txid: tx(n),
    txBytes: 700, inputs: 1, maxUnlockingBytes: 100, height, ...(escrow ? { escrow } : {}) });
  const rRun: RegtestRunFile = { ...run, steps: [step, r(1, 300, 'createEscrow', 'bchreg:pr'), r(2, 301, 'fund'),
    r(3, 302, 'release')],
  refused: [{ branch: 'R', step: 'release', refused: true, by: 'buyer', expected: 'NotSeller', rawTxHash: tx(9),
    serverError: 'Request failed after 1 attempts: Error: mandatory-script-verify-flag-failed (x) (code 16)',
    at: '2026-11-18T16:41:13.836Z', afterTxid: tx(2) }] };

  it('keeps branch R only, with the refused attempt after the step it followed', () => {
    const e = refusedExample(rRun);
    expect(e).toMatchObject({ node: 'Bitcoin Cash Node 29.0.0', branch: 'R', asset: 'BCH', address: 'bchreg:pr' });
    expect(e.steps.map((s) => s.step)).toEqual(['createEscrow', 'fund', 'release', 'release']);
    expect(e.steps[2]).toMatchObject({ refused: true, serverError: 'mandatory-script-verify-flag-failed (x) (code 16)' });
  });

  it('refuses a run without refused attempts', () => {
    expect(() => refusedExample(run)).toThrow(/no refused attempts/);
  });
});
