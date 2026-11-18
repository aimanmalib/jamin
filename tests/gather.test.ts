// The wallet gather plan (decision 0016): which coins move to the seller and what the fee payers keep.
import { describe, expect, it } from 'vitest';
import type { Utxo } from '@solidcash/solidcash';
import { DUST_SATS, gatherPlan } from '../src/wallet/gather.js';

const coin = (satoshis: bigint, vout = 0): Utxo => ({ txid: 'aa'.repeat(32), vout, satoshis });
const token: Utxo = { txid: 'bb'.repeat(32), vout: 1, satoshis: 1_000n,
  token: { category: 'cc'.repeat(32), amount: 1n } };

describe('wallet gather plan', () => {
  it('takes the spare coins of the keepers, all plain coins of the others, never the seller or a token coin', () => {
    const plan = gatherPlan([
      { name: 'seller', coins: [coin(30_507n)] },
      { name: 'buyer', coins: [coin(44_877n)] },
      { name: 'arbitrator', coins: [coin(29_945n)] },
      { name: 'fees', coins: [coin(2_838n), token] },
    ], { buyer: 20_000n, arbitrator: 20_000n });
    expect(plan.inputs.map((i) => i.name)).toEqual(['buyer', 'arbitrator', 'fees']);
    expect(plan.inputs.flatMap((i) => i.coins).some((u) => u.token)).toBe(false);
    expect(plan.keeps).toEqual([{ name: 'buyer', amount: 20_000n }, { name: 'arbitrator', amount: 20_000n }]);
    expect(plan.taken).toBe(44_877n + 29_945n + 2_838n);
  });

  it('leaves a party alone when only dust would move or it holds nothing', () => {
    const plan = gatherPlan([
      { name: 'buyer', coins: [coin(20_000n + DUST_SATS - 1n)] },
      { name: 'arbiterB', coins: [] },
      { name: 'arbiterC', coins: [token] },
    ], { buyer: 20_000n });
    expect(plan.inputs).toEqual([]);
    expect(plan.taken).toBe(0n);
  });
});
