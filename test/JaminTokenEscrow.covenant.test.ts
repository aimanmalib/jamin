// CashToken escrow covenant: the contract fixes who receives the tokens and how many. Each call is signed by the
// right role; only the token outputs differ from the contract's.
import { describe, expect, it } from 'vitest';
import {
  TERMS, Status, deploy, entry, lockOf, lockTimeNow, roleParams, statusOf, tokensAt, type World,
} from './helpers/escrow.js';
import { TOKEN, byHand, openToken, paidToken, tokenWorld, type TokenWorld } from './helpers/flows.js';

const OUTPUT_CHECK = /preflight failed at input 0|VM failed/;

function lock(w: World, role: keyof World['roles']): Uint8Array {
  return lockOf(w.roles[role].address);
}

async function release(w: TokenWorld, sc: Awaited<ReturnType<typeof openToken>>, pay: Array<[keyof World['roles'],
  bigint]>): Promise<unknown> {
  let call = byHand(w, sc, 'seller', await lockTimeNow(w), 'release', w.category);
  for (const [role, units] of pay) call = call.tokenContainerTransfer(w.category, lock(w, role), units);
  return call.send();
}

describe('JaminTokenEscrow (CashToken) covenant', () => {
  it('accepts a token release whose payments are named by hand exactly as the contract pays them', async () => {
    const w = await tokenWorld();
    const sc = await paidToken(w);
    await release(w, sc, [['fees', TOKEN.fee], ['buyer', TOKEN.amount]]);
    expect(await statusOf(sc)).toBe(Status.Released);
    expect(await tokensAt(w.provider, w.roles.buyer.address, w.category)).toBe(TOKEN.amount);
  });

  it('rejects a token release that pays the tokens to someone other than the buyer', async () => {
    const w = await tokenWorld();
    const sc = await paidToken(w);
    await expect(release(w, sc, [['fees', TOKEN.fee], ['outsider', TOKEN.amount]])).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Paid);
    expect(await tokensAt(w.provider, w.roles.outsider.address, w.category)).toBe(0n);
  });

  it('rejects a token release that pays the buyer one unit less', async () => {
    const w = await tokenWorld();
    const sc = await paidToken(w);
    await expect(release(w, sc, [['fees', TOKEN.fee], ['buyer', TOKEN.amount - 1n]])).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('rejects a token release that sends the token fee to the buyer', async () => {
    const w = await tokenWorld();
    const sc = await paidToken(w);
    await expect(release(w, sc, [['buyer', TOKEN.fee], ['buyer', TOKEN.amount]])).rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('rejects a token buyer cancel that pays the buyer instead of the seller', async () => {
    const w = await tokenWorld();
    const sc = await openToken(w);
    await expect(byHand(w, sc, 'buyer', await lockTimeNow(w), 'buyerCancel', w.category)
      .tokenContainerTransfer(w.category, lock(w, 'buyer'), TOKEN.amount + TOKEN.fee).send())
      .rejects.toThrow(OUTPUT_CHECK);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  // The units not deposited go back to the seller, so the SDK does not refuse the call as a token burn first.
  it('rejects a token deposit short of amount + fee + reserve (WrongDeposit)', async () => {
    const w = await tokenWorld();
    const { seller } = w.roles;
    const { sc } = await deploy(w, 'JaminTokenEscrow', [...roleParams(w.roles), w.category],
      [TOKEN.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
    await expect(entry(sc.connect(seller), 'deposit', w.sig(seller), w.category)
      .addInput(w.sellerCoin, seller.unlockP2PKH()).tokenContainerDeposit(w.category, TOKEN.amount)
      .addOutput({ to: lockOf(seller.address), amount: 1_000n,
        token: { category: w.category, amount: TOKEN.fee + TOKEN.reserve } }).send())
      .rejects.toThrow(/WrongDeposit/);
    expect(await statusOf(sc)).toBe(Status.Created);
  });
});
