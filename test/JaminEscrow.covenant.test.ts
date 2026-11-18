// BCH escrow covenant: the contract fixes who is paid and how much. Each call below is signed by the right role;
// only the outputs differ from the contract's, so a rejection comes from the output checks, not from a signature.
import { describe, expect, it } from 'vitest';
import { TERMS, Status, entry, lockOf, lockTimeNow, satsAt, statusOf, world, type World } from './helpers/escrow.js';
import { BCH_FEE, byHand, byPanel, disputedBch, openBch, paidBch, waitOut } from './helpers/flows.js';

const AMOUNT = TERMS.amount;
// The SDK names this when the contract input's script fails a check (no custom error: the payout checks are
// compiled from `this.transfer`, not written as a `require`).
const OUTPUT_CHECK = /preflight failed at input 0|VM failed/;

function lock(w: World, role: keyof World['roles']): Uint8Array {
  return lockOf(w.roles[role].address);
}

describe('JaminEscrow (BCH) covenant', () => {
  it('accepts a release whose payments are named by hand exactly as the contract pays them', async () => {
    const w = await world();
    const sc = await openBch(w);
    const before = await satsAt(w.provider, w.roles.buyer.address);
    await byHand(w, sc, 'seller', await lockTimeNow(w), 'release').transfer(lock(w, 'fees'), BCH_FEE)
      .transfer(lock(w, 'buyer'), AMOUNT).send();
    expect(await statusOf(sc)).toBe(Status.Released);
    expect(await satsAt(w.provider, w.roles.buyer.address) - before).toBe(AMOUNT);
  });

  it('rejects a release that pays the amount to someone other than the buyer', async () => {
    const w = await world();
    const sc = await openBch(w);
    const before = await satsAt(w.provider, w.roles.outsider.address);
    await expect(byHand(w, sc, 'seller', await lockTimeNow(w), 'release').transfer(lock(w, 'fees'), BCH_FEE)
      .transfer(lock(w, 'outsider'), AMOUNT).send()).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Funded);
    expect(await satsAt(w.provider, w.roles.outsider.address)).toBe(before);
  });

  it('rejects a release that pays the buyer less than the amount', async () => {
    const w = await world();
    const sc = await openBch(w);
    await expect(byHand(w, sc, 'seller', await lockTimeNow(w), 'release').transfer(lock(w, 'fees'), BCH_FEE)
      .transfer(lock(w, 'buyer'), AMOUNT - 1_000n).send()).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a release that sends the fee to the buyer instead of the fee recipient', async () => {
    const w = await world();
    const sc = await openBch(w);
    await expect(byHand(w, sc, 'seller', await lockTimeNow(w), 'release').transfer(lock(w, 'buyer'), BCH_FEE)
      .transfer(lock(w, 'buyer'), AMOUNT).send()).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a release with an extra payment out of the escrow', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await openBch(w);
    await expect(entry(sc.connect(seller), 'release', w.sig(seller)).transfer(lock(w, 'outsider'), AMOUNT).send())
      .rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a buyer cancel that pays the buyer instead of the seller', async () => {
    const w = await world();
    const sc = await paidBch(w);
    await expect(byHand(w, sc, 'buyer', await lockTimeNow(w), 'buyerCancel').transfer(lock(w, 'buyer'), AMOUNT + BCH_FEE).send())
      .rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('rejects a seller cancel that keeps the fee in a second output to the fee recipient', async () => {
    const w = await world();
    const sc = await openBch(w);
    await waitOut(w);
    await expect(byHand(w, sc, 'seller', await lockTimeNow(w), 'sellerCancel').transfer(lock(w, 'seller'), AMOUNT)
      .transfer(lock(w, 'fees'), BCH_FEE).send()).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a dispute resolution for the buyer that pays the seller', async () => {
    const w = await world();
    const sc = await disputedBch(w);
    await expect(byPanel(w, sc, await lockTimeNow(w), true).transfer(lock(w, 'fees'), BCH_FEE)
      .transfer(lock(w, 'seller'), AMOUNT + TERMS.disputeFee).send()).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Disputed);
  });
});
