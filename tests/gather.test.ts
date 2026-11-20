// The wallet gather plan (decision 0016): which coins move to the seller and what the fee payers keep.
import { describe, expect, it } from 'vitest';
import { randomUtxo, type Utxo } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { party, type Party, type PartyName } from '../src/lifecycle/context.js';
import { asProvider } from '../src/sdk/mock.js';
import { DUST_SATS, gather, gatherPlan } from '../src/wallet/gather.js';

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

describe('wallet gather on a network', () => {
  const NAMES: PartyName[] = ['seller', 'buyer', 'arbitrator', 'arbiterB', 'arbiterC', 'fees'];
  async function wallet(feesCoin: bigint): Promise<Record<PartyName, Party>> {
    const mock = new MockNetworkProvider();
    const provider = asProvider(mock);
    const parties = Object.fromEntries(NAMES.map((n, i) => [n, party(new Uint8Array(32).fill(i + 1), provider)])) as
      Record<PartyName, Party>;
    await mock.addUtxo(parties.fees.address, randomUtxo({ satoshis: feesCoin }));
    return parties;
  }

  it('sends nothing when the fee would eat the only output (the network refuses a transaction without outputs)', async () => {
    const parties = await wallet(DUST_SATS + 50n);
    const r = await gather(parties.seller.signer.provider, parties, {}, 1);
    expect(r.txid).toBeUndefined();
    expect(r.plan.inputs).toEqual([]);
  }, 120_000);

  it('moves a coin that leaves more than dust after the fee to the seller', async () => {
    const parties = await wallet(5_000n);
    const r = await gather(parties.seller.signer.provider, parties, {}, 1);
    expect(r.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(r.plan.inputs.map((i) => i.name)).toEqual(['fees']);
  }, 120_000);
});
