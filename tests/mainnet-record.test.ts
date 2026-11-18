// examples/mainnet.json as the mainnet run writes it: one escrow per createEscrow, later steps joining their branch's
// latest escrow (D finished in a later run), no txid twice.
import { describe, expect, it } from 'vitest';
import { addSteps, refusedRow, serverText, unmined, withHeights, type MainnetRecord } from '../src/lifecycle/record.js';
import type { RefusedStep } from '../src/lifecycle/context.js';

const tx = (n: number): string => n.toString(16).padStart(64, '0');
const EMPTY: MainnetRecord = { network: 'mainnet', escrows: [] };

describe('mainnet record', () => {
  it('groups steps into escrows with their address and asset', () => {
    const r = addSteps(EMPTY, [
      { branch: 'A', step: 'createEscrow', txid: tx(1), escrow: 'bitcoincash:pa', height: 900_000 },
      { branch: 'A', step: 'fund', txid: tx(2) },
      { branch: 'B', step: 'createEscrow', txid: tx(3), escrow: 'bitcoincash:pb' },
      { branch: 'A', step: 'release', txid: tx(4) },
    ]);
    expect(r.escrows).toEqual([
      { branch: 'A', asset: 'BCH', address: 'bitcoincash:pa', steps: [
        { step: 'createEscrow', txid: tx(1), height: 900_000 }, { step: 'fund', txid: tx(2) },
        { step: 'release', txid: tx(4) }] },
      { branch: 'B', asset: 'PUSD', address: 'bitcoincash:pb', steps: [{ step: 'createEscrow', txid: tx(3) }] },
    ]);
  });

  it('adds the D step of a later run to the D escrow and never repeats a txid', () => {
    const first = addSteps(EMPTY, [
      { branch: 'D', step: 'createEscrow', txid: tx(5), escrow: 'bitcoincash:pd' },
      { branch: 'D', step: 'fund', txid: tx(6) },
    ]);
    const second = addSteps(first, [{ branch: 'D', step: 'fund', txid: tx(6) },
      { branch: 'D', step: 'sellerCancel', txid: tx(7) }]);
    expect(second.escrows).toHaveLength(1);
    expect(second.escrows[0]?.steps.map((s) => s.step)).toEqual(['createEscrow', 'fund', 'sellerCancel']);
    expect(first.escrows[0]?.steps).toHaveLength(2);
  });

  it('keeps the size and fee of each step and fills in block heights later', () => {
    const r = addSteps(EMPTY, [
      { branch: 'A', step: 'createEscrow', txid: tx(8), escrow: 'bitcoincash:pa', txBytes: 758, feeSats: 1758 },
      { branch: 'A', step: 'fund', txid: tx(9), height: 900_001 },
    ]);
    expect(r.escrows[0]?.steps[0]).toEqual({ step: 'createEscrow', txid: tx(8), txBytes: 758, feeSats: 1758 });
    expect(unmined(r)).toEqual([tx(8)]);
    const mined = withHeights(r, new Map([[tx(8), 900_000], [tx(9), 1]]));
    expect(mined.escrows[0]?.steps.map((s) => ('height' in s ? s.height : undefined))).toEqual([900_000, 900_001]);
    expect(unmined(mined)).toEqual([]);
    expect(r.escrows[0]?.steps[0]).not.toHaveProperty('height');
  });

  const refusal = (step: string, n: number, afterTxid: string): RefusedStep => ({ branch: 'R', step, refused: true,
    by: step === 'release' ? 'buyer' : 'seller', expected: step === 'release' ? 'NotSeller' : 'TooEarly',
    rawTxHash: tx(n), serverError: `Request failed after 1 attempts: Error: refused ${n} (code 16)`,
    at: '2026-11-18T16:41:06.092Z', afterTxid });

  it('puts a refused attempt after the step it followed, in the shape the gate reads (no txid)', () => {
    const r = addSteps(EMPTY, [
      { branch: 'R', step: 'createEscrow', txid: tx(1), escrow: 'bitcoincash:pr' },
      { branch: 'R', step: 'fund', txid: tx(2) },
      { branch: 'R', step: 'markAsPaid', txid: tx(3) },
      { branch: 'R', step: 'release', txid: tx(4) },
    ], [refusal('sellerCancel', 10, tx(2)), refusal('release', 11, tx(3))]);
    const steps = r.escrows[0]?.steps ?? [];
    expect(steps.map((s) => s.step)).toEqual(['createEscrow', 'fund', 'sellerCancel', 'markAsPaid', 'release', 'release']);
    expect(steps[2]).toEqual({ step: 'sellerCancel', refused: true, by: 'seller', expected: 'TooEarly', rawTxHash: tx(10),
      serverError: 'refused 10 (code 16)', at: '2026-11-18T16:41:06.092Z' });
    expect(steps[4]).not.toHaveProperty('txid');
    expect(r.escrows[0]?.asset).toBe('BCH');
    expect(unmined(withHeights(r, new Map([[tx(1), 1], [tx(2), 2], [tx(3), 3], [tx(4), 4]])))).toEqual([]);
    // A second write of the same run adds nothing.
    expect(addSteps(r, [], [refusal('sellerCancel', 10, tx(2))])).toEqual(r);
  });

  it('refuses to place an attempt whose preceding step is not recorded', () => {
    expect(() => addSteps(EMPTY, [], [refusal('release', 12, tx(99))])).toThrow(/no recorded step/);
  });

  it('keeps the server text and cuts only the provider retry note', () => {
    expect(serverText('Request failed after 1 attempts: Error: non-final (code 64)')).toBe('non-final (code 64)');
    expect(serverText('the transaction was rejected by network rules.\n\nnon-final')).toBe(
      'the transaction was rejected by network rules.\n\nnon-final');
    expect(refusedRow(refusal('release', 13, tx(3)))).not.toHaveProperty('afterTxid');
  });
});
