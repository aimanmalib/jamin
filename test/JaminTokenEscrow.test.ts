// CashToken escrow lifecycle on the production-profile mock network, with a test token issued on the mock.
import { describe, expect, it } from 'vitest';
import { TERMS, Status, entry, lockOf, lockTimeNow, panelSigs, statusOf, tokensAt } from './helpers/escrow.js';
import { TOKEN, openToken, tokenWorld, type TokenWorld, waitOut } from './helpers/flows.js';

const AMOUNT = TOKEN.amount;
const FEE = TOKEN.fee;

async function openFunded(w: TokenWorld): Promise<{ sc: Awaited<ReturnType<typeof openToken>> }> {
  return { sc: await openToken(w) };
}

describe('JaminTokenEscrow (CashToken)', () => {
  it('takes the deposit and the buyer marks it paid', async () => {
    const w = await tokenWorld();
    const { buyer } = w.roles;
    const { sc } = await openFunded(w);
    await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer), w.category).send();
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('releases tokens to the buyer and the token fee to the fee recipient', async () => {
    const w = await tokenWorld();
    const { seller, buyer, fees } = w.roles;
    const { sc } = await openFunded(w);
    await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer), w.category).send();
    await entry(sc.connect(seller), 'release', w.sig(seller), w.category).send();
    expect(await statusOf(sc)).toBe(Status.Released);
    expect(await tokensAt(w.provider, buyer.address, w.category)).toBe(AMOUNT);
    expect(await tokensAt(w.provider, fees.address, w.category)).toBe(FEE);
  });

  it('lets the buyer cancel: tokens return to the seller', async () => {
    const w = await tokenWorld();
    const { seller, buyer } = w.roles;
    const { sc } = await openFunded(w);
    await entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer), w.category).send();
    expect(await statusOf(sc)).toBe(Status.CancelledByBuyer);
    expect(await tokensAt(w.provider, seller.address, w.category)).toBe(AMOUNT + FEE);
  });

  it('lets the seller cancel after the waiting time', async () => {
    const w = await tokenWorld();
    const { seller } = w.roles;
    const { sc } = await openFunded(w);
    await waitOut(w);
    await entry(sc.connect(seller), 'sellerCancel', w.sig(seller), w.category).setLocktime(await lockTimeNow(w))
      .tokenContainerTransfer(w.category, lockOf(seller.address), AMOUNT + FEE).send();
    expect(await statusOf(sc)).toBe(Status.CancelledBySeller);
    expect(await tokensAt(w.provider, seller.address, w.category)).toBe(AMOUNT + FEE);
  });

  it('resolves a dispute for the buyer with BCH dispute fees', async () => {
    const w = await tokenWorld();
    const { seller, buyer, arbitrator } = w.roles;
    const { sc } = await openFunded(w);
    await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer), w.category).send();
    await entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
    await entry(sc.connect(seller), 'openDispute', w.sig(seller), false).withValue(TERMS.disputeFee).send();
    await entry(sc.connect(arbitrator), 'resolveDispute', ...panelSigs(w), w.category, true).send();
    expect(await statusOf(sc)).toBe(Status.Resolved);
    expect(await tokensAt(w.provider, buyer.address, w.category)).toBe(AMOUNT);
  });

  it('rejects a call naming another token category (WrongToken)', async () => {
    const w = await tokenWorld();
    const { buyer } = w.roles;
    const { sc } = await openFunded(w);
    await expect(entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer), 'ab'.repeat(32)).send())
      .rejects.toThrow(/WrongToken/);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });
});
