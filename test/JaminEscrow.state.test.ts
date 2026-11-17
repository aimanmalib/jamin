// BCH escrow state rules: bad terms at creation, calls in the wrong status, signatures of the wrong role, and closed
// escrows that cannot be spent again.
import { describe, expect, it } from 'vitest';
import { RESERVE_SATS, TERMS, Status, deploy, entry, lockOf, lockTimeNow, roleParams, statusOf, world, type World } from './helpers/escrow.js';
import { BCH_FEE, byHand, disputedBch, openBch, paidBch } from './helpers/flows.js';

type Escrow = Awaited<ReturnType<typeof openBch>>;

// A failing `require` in the constructor stops the deployment, but SolidCash 0.51.1 reports only the VM failure,
// not the custom error (docs/SOLIDCASH-FINDINGS.md, F8).
const CONSTRUCTOR_CHECK = /initial state commitments from constructor.*OP_VERIFY/;

function create(w: World, amount: bigint, disputeFee: bigint, cancelAfter: bigint): Promise<unknown> {
  return deploy(w, 'JaminEscrow', roleParams(w.roles), [amount, TERMS.feeBps, disputeFee, cancelAfter]);
}

/**
 * Every entry point of a closed escrow, each signed by the role it names, must be refused. Only the reserve that
 * opened the satoshi container is left, so the payouts below try to take that.
 */
async function expectClosed(w: World, sc: Escrow, status: bigint): Promise<void> {
  const { seller, buyer, outsider } = w.roles;
  await expect(entry(sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount + BCH_FEE).send())
    .rejects.toThrow(/AlreadyFunded/);
  await expect(entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send()).rejects.toThrow(/AlreadyMarkedPaid/);
  await expect(entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer)).send()).rejects.toThrow(/NotOpen/);
  await expect(byHand(w, sc, 'seller', await lockTimeNow(w), 'release')
    .transfer(lockOf(outsider.address), RESERVE_SATS).send()).rejects.toThrow(/NotOpen/);
  await expect(byHand(w, sc, 'seller', await lockTimeNow(w), 'sellerCancel')
    .transfer(lockOf(seller.address), RESERVE_SATS).send()).rejects.toThrow(/AlreadyMarkedPaid/);
  await expect(entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send())
    .rejects.toThrow(/NotPaid/);
  expect(await statusOf(sc)).toBe(status);
}

describe('JaminEscrow (BCH) state rules', () => {
  it('refuses to create an escrow with a zero amount (InvalidAmount)', async () => {
    const w = await world();
    await expect(create(w, 0n, TERMS.disputeFee, w.cancelAfter)).rejects.toThrow(CONSTRUCTOR_CHECK);
  });

  it('refuses to create an escrow without a dispute fee (InvalidDisputeFee)', async () => {
    const w = await world();
    await expect(create(w, TERMS.amount, 0n, w.cancelAfter)).rejects.toThrow(CONSTRUCTOR_CHECK);
  });

  it('refuses a waiting time given as a block height (InvalidCancelTime)', async () => {
    const w = await world();
    await expect(create(w, TERMS.amount, TERMS.disputeFee, 900_000n)).rejects.toThrow(CONSTRUCTOR_CHECK);
  });

  it('refuses a second deposit (AlreadyFunded)', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await openBch(w);
    await expect(entry(sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount + BCH_FEE).send())
      .rejects.toThrow(/AlreadyFunded/);
  });

  it('refuses mark as paid before the deposit (NotFunded)', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const { sc } = await deploy(w, 'JaminEscrow', roleParams(w.roles),
      [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
    await expect(entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send()).rejects.toThrow(/NotFunded/);
    expect(await statusOf(sc)).toBe(Status.Created);
  });

  it('refuses a dispute resolution when no dispute is open (NoDispute)', async () => {
    const w = await world();
    const sc = await paidBch(w);
    await expect(byHand(w, sc, 'arbitrator', await lockTimeNow(w), 'resolveDispute', true).transfer(lockOf(w.roles.fees.address),
      BCH_FEE).transfer(lockOf(w.roles.buyer.address), TERMS.amount).send()).rejects.toThrow(/NoDispute/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('refuses a buyer cancel signed by the seller (NotBuyer)', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await openBch(w);
    await expect(entry(sc.connect(seller), 'buyerCancel', w.sig(seller)).send()).rejects.toThrow(/NotBuyer/);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('refuses a deposit signed by the buyer (NotSeller)', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const { sc } = await deploy(w, 'JaminEscrow', roleParams(w.roles),
      [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
    await expect(entry(sc.connect(buyer), 'fund', w.sig(buyer)).withValue(TERMS.amount + BCH_FEE).send())
      .rejects.toThrow(/NotSeller/);
    expect(await statusOf(sc)).toBe(Status.Created);
  });

  it('refuses a buyer-side dispute signed by the seller (NotBuyer)', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await paidBch(w);
    await expect(entry(sc.connect(seller), 'openDispute', w.sig(seller), true).withValue(TERMS.disputeFee).send())
      .rejects.toThrow(/NotBuyer/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('refuses a seller-side dispute signed by an outsider (NotSeller)', async () => {
    const w = await world();
    const { outsider } = w.roles;
    const sc = await paidBch(w);
    await expect(entry(sc.connect(outsider), 'openDispute', w.sig(outsider), false).withValue(TERMS.disputeFee)
      .send()).rejects.toThrow(/NotSeller/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('cannot be spent again once released', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await paidBch(w);
    await entry(sc.connect(seller), 'release', w.sig(seller)).send();
    await expectClosed(w, sc, Status.Released);
  });

  it('cannot be spent again once cancelled by the buyer', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const sc = await openBch(w);
    await entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer)).send();
    await expectClosed(w, sc, Status.CancelledByBuyer);
  });

  it('cannot be spent again once the dispute is resolved', async () => {
    const w = await world();
    const { arbitrator } = w.roles;
    const sc = await disputedBch(w);
    await entry(sc.connect(arbitrator), 'resolveDispute', w.sig(arbitrator), false).send();
    await expectClosed(w, sc, Status.Resolved);
  });
});
