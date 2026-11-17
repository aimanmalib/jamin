// examples/mainnet.json as the mainnet run writes it: one escrow per createEscrow, later steps joining their branch's
// latest escrow (D finished in a later run), no txid twice.
import { describe, expect, it } from 'vitest';
import { addSteps, type MainnetRecord } from '../src/lifecycle/record.js';

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
});
