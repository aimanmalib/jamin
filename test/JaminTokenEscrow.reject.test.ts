// CashToken escrow rejections and the seller-wins dispute: each rejection fails if the check it names is removed.
import { describe, expect, it } from 'vitest';
import { TERMS, Status, entry, lockOf, lockTimeNow, satsAt, statusOf, tokensAt, tooEarly } from './helpers/escrow.js';
import { TOKEN, disputedToken, openToken, paidToken, tokenWorld, type TokenWorld, waitOut } from './helpers/flows.js';

const AMOUNT = TOKEN.amount;
const FEE = TOKEN.fee;
const openFunded = openToken;
const paid = paidToken;
const disputed = disputedToken;
type Escrow = Awaited<ReturnType<typeof openToken>>;

function sellerCancel(w: TokenWorld, sc: Escrow, lockTime: number): Promise<unknown> {
  const { seller } = w.roles;
  return entry(sc.connect(seller), 'sellerCancel', w.sig(seller), w.category).setLocktime(lockTime)
    .tokenContainerTransfer(w.category, lockOf(seller.address), AMOUNT + FEE).send();
}

describe('JaminTokenEscrow (CashToken) rejections', () => {
  it('rejects a seller cancel before the waiting time (TooEarly)', async () => {
    const w = await tokenWorld();
    const sc = await openFunded(w);
    await expect(sellerCancel(w, sc, await lockTimeNow(w))).rejects.toThrow(tooEarly(w));
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a seller cancel after mark as paid, even after the waiting time (AlreadyMarkedPaid)', async () => {
    const w = await tokenWorld();
    const sc = await paid(w);
    await waitOut(w);
    await expect(sellerCancel(w, sc, await lockTimeNow(w))).rejects.toThrow(/AlreadyMarkedPaid/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  for (const role of ['buyer', 'seller', 'outsider'] as const) {
    it(`rejects a dispute resolution signed by the ${role} (NotArbitrator)`, async () => {
      const w = await tokenWorld();
      const signer = w.roles[role];
      const sc = await disputed(w);
      await expect(entry(sc.connect(signer), 'resolveDispute', w.sig(signer), w.category, true).send())
        .rejects.toThrow(/NotArbitrator/);
      expect(await statusOf(sc)).toBe(Status.Disputed);
    });
  }

  it('rejects a dispute before the buyer marked it paid (NotPaid)', async () => {
    const w = await tokenWorld();
    const { buyer } = w.roles;
    const sc = await openFunded(w);
    await expect(entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send())
      .rejects.toThrow(/NotPaid/);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a dispute with the wrong dispute fee (WrongDisputeFee)', async () => {
    const w = await tokenWorld();
    const { seller } = w.roles;
    const sc = await paid(w);
    await expect(entry(sc.connect(seller), 'openDispute', w.sig(seller), false).withValue(TERMS.disputeFee + 1n)
      .send()).rejects.toThrow(/WrongDisputeFee/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('rejects a second dispute fee from the same side (AlreadyPaidDispute)', async () => {
    const w = await tokenWorld();
    const { buyer } = w.roles;
    const sc = await disputed(w);
    await expect(entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send())
      .rejects.toThrow(/AlreadyPaidDispute/);
  });

  it('rejects a release once disputed (NotOpen)', async () => {
    const w = await tokenWorld();
    const { seller } = w.roles;
    const sc = await disputed(w);
    await expect(entry(sc.connect(seller), 'release', w.sig(seller), w.category).send()).rejects.toThrow(/NotOpen/);
    expect(await statusOf(sc)).toBe(Status.Disputed);
  });

  it('rejects a buyer cancel once disputed (NotOpen)', async () => {
    const w = await tokenWorld();
    const { buyer } = w.roles;
    const sc = await disputed(w);
    await expect(entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer), w.category).send())
      .rejects.toThrow(/NotOpen/);
    expect(await statusOf(sc)).toBe(Status.Disputed);
  });

  it('resolves a two-sided dispute for the seller: tokens and fee back, BCH dispute fees settled', async () => {
    const w = await tokenWorld();
    const { seller, arbitrator, fees } = w.roles;
    const sc = await disputed(w);
    await entry(sc.connect(seller), 'openDispute', w.sig(seller), false).withValue(TERMS.disputeFee).send();
    const sellerSats = await satsAt(w.provider, seller.address);
    const feeSats = await satsAt(w.provider, fees.address);
    await entry(sc.connect(arbitrator), 'resolveDispute', w.sig(arbitrator), w.category, false).send();
    expect(await statusOf(sc)).toBe(Status.Resolved);
    expect(await tokensAt(w.provider, seller.address, w.category)).toBe(AMOUNT + FEE);
    expect(await tokensAt(w.provider, fees.address, w.category)).toBe(0n);
    expect(await satsAt(w.provider, fees.address) - feeSats).toBe(TERMS.disputeFee);
    expect(await satsAt(w.provider, seller.address) - sellerSats).toBe(TERMS.disputeFee);
  });
});
