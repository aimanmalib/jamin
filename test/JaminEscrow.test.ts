// BCH escrow lifecycle on the production-profile mock network. Rejections are in JaminEscrow.reject.test.ts.
import { describe, expect, it } from 'vitest';
import {
  TERMS, Status, deploy, entry, lockOf, lockTimeNow, panelSigs, roleParams, satsAt, statusOf, world, type World,
} from './helpers/escrow.js';
import { BCH_FEE, openBch, waitOut } from './helpers/flows.js';

const FEE = BCH_FEE;
const INIT = [TERMS.amount, TERMS.feeBps, TERMS.disputeFee];

async function open(w: World): Promise<{ sc: Awaited<ReturnType<typeof openBch>> }> {
  return { sc: await openBch(w) };
}

describe('JaminEscrow (BCH)', () => {
  it('creates a funded escrow with the basis-point fee', async () => {
    const w = await world();
    const { sc } = await open(w);
    const state = await sc.getState() as { terms: Record<string, bigint> };
    expect(await statusOf(sc)).toBe(Status.Funded);
    expect(state.terms).toMatchObject({ amount: TERMS.amount, fee: FEE, disputeFee: TERMS.disputeFee,
      sellerCanCancelAfter: w.cancelAfter });
  });

  it('raises a fee below the dust limit to 546 sats', async () => {
    const w = await world();
    const { sc } = await deploy(w, 'JaminEscrow', roleParams(w.roles), [20_000n, 30n, TERMS.disputeFee,
      w.cancelAfter]);
    const state = await sc.getState() as { terms: { fee: bigint } };
    expect(state.terms.fee).toBe(546n);
  });

  it('marks as paid, then releases the amount to the buyer and the fee to the fee recipient', async () => {
    const w = await world();
    const { seller, buyer, fees } = w.roles;
    const { sc } = await open(w);
    await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
    expect(await statusOf(sc)).toBe(Status.Paid);
    const buyerBefore = await satsAt(w.provider, buyer.address);
    const feesBefore = await satsAt(w.provider, fees.address);
    await entry(sc.connect(seller), 'release', w.sig(seller)).send();
    expect(await statusOf(sc)).toBe(Status.Released);
    expect(await satsAt(w.provider, fees.address) - feesBefore).toBe(FEE);
    expect(await satsAt(w.provider, buyer.address) - buyerBefore).toBe(TERMS.amount);
  });

  it('lets the buyer cancel: amount and fee return to the seller', async () => {
    const w = await world();
    const { seller, buyer } = w.roles;
    const { sc } = await open(w);
    const sellerBefore = await satsAt(w.provider, seller.address);
    await entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer)).send();
    expect(await statusOf(sc)).toBe(Status.CancelledByBuyer);
    expect(await satsAt(w.provider, seller.address) - sellerBefore).toBe(TERMS.amount + FEE);
  });

  it('lets the seller cancel after the waiting time', async () => {
    const w = await world();
    const { seller } = w.roles;
    const { sc } = await open(w);
    await waitOut(w);
    await entry(sc.connect(seller), 'sellerCancel', w.sig(seller)).setLocktime(await lockTimeNow(w))
      .transfer(lockOf(seller.address), TERMS.amount + FEE).send();
    expect(await statusOf(sc)).toBe(Status.CancelledBySeller);
  });

  for (const buyerWins of [true, false]) {
    it(`resolves a two-sided dispute for the ${buyerWins ? 'buyer' : 'seller'}`, async () => {
      const w = await world();
      const { seller, buyer, arbitrator, fees } = w.roles;
      const { sc } = await open(w);
      await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
      await entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
      expect(await statusOf(sc)).toBe(Status.Disputed);
      await entry(sc.connect(seller), 'openDispute', w.sig(seller), false).withValue(TERMS.disputeFee).send();
      const feesBefore = await satsAt(w.provider, fees.address);
      await entry(sc.connect(arbitrator), 'resolveDispute', ...panelSigs(w), buyerWins).send();
      expect(await statusOf(sc)).toBe(Status.Resolved);
      const expectedFees = (buyerWins ? FEE : 0n) + TERMS.disputeFee;
      expect(await satsAt(w.provider, fees.address) - feesBefore).toBe(expectedFees);
    });
  }

  it('emits Released with the amount and the fee', async () => {
    const w = await world();
    const { seller } = w.roles;
    const { sc } = await open(w);
    const { txid } = await entry(sc.connect(seller), 'release', w.sig(seller)).send();
    const logs = await sc.queryFilter('Released') as Array<{ txid: string; args: Record<string, unknown> }>;
    expect(logs.find((e) => e.txid === txid)?.args).toMatchObject({ amount: TERMS.amount, fee: FEE });
  });

  it('rejects a release signed by anyone but the seller (NotSeller)', async () => {
    const w = await world();
    const { outsider } = w.roles;
    const { sc } = await open(w);
    await expect(entry(sc.connect(outsider), 'release', w.sig(outsider)).send()).rejects.toThrow(/NotSeller/);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects mark as paid by the seller (NotBuyer)', async () => {
    const w = await world();
    const { seller } = w.roles;
    const { sc } = await open(w);
    await expect(entry(sc.connect(seller), 'markAsPaid', w.sig(seller)).send()).rejects.toThrow(/NotBuyer/);
  });

  it('rejects a deposit that is not exactly amount + fee (WrongDeposit)', async () => {
    const w = await world();
    const { seller } = w.roles;
    const { sc } = await deploy(w, 'JaminEscrow', roleParams(w.roles), [...INIT, w.cancelAfter]);
    await expect(entry(sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount).send())
      .rejects.toThrow(/WrongDeposit/);
    expect(await statusOf(sc)).toBe(Status.Created);
  });
});
