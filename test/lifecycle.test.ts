// The five lifecycle branches end to end, as they are later run on regtest and mainnet: A release (BCH), B release
// (CashToken), C buyer cancel, D seller cancel after the waiting time, E dispute and resolution. Each branch checks
// that every party receives its share and that the escrow keeps only the reserve that opened it.
import { describe, expect, it } from 'vitest';
import { RESERVE_SATS, TERMS, Status, entry, lockOf, lockTimeNow, panelSigs, satsAt, statusOf, tokensAt, world, type World }
  from './helpers/escrow.js';
import { BCH_FEE, TOKEN, openBch, paidBch, paidToken, tokenWorld, waitOut } from './helpers/flows.js';

type Escrow = Awaited<ReturnType<typeof openBch>>;

async function eventCount(sc: Escrow, name: string): Promise<number> {
  return (await sc.queryFilter(name) as unknown[]).length;
}

/** Satoshi changes at each role's address while `run` executes. */
async function deltas(w: World, run: () => Promise<unknown>): Promise<Record<keyof World['roles'], bigint>> {
  const roles = Object.keys(w.roles) as Array<keyof World['roles']>;
  const before = await Promise.all(roles.map((r) => satsAt(w.provider, w.roles[r].address)));
  await run();
  const after = await Promise.all(roles.map((r) => satsAt(w.provider, w.roles[r].address)));
  return Object.fromEntries(roles.map((r, i) => [r, (after[i] ?? 0n) - (before[i] ?? 0n)])) as
    Record<keyof World['roles'], bigint>;
}

describe('lifecycle branches', () => {
  it('A: BCH release pays the buyer and the fee, and leaves only the reserve', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await paidBch(w);
    expect(await sc.getBalance()).toBe(RESERVE_SATS + TERMS.amount + BCH_FEE);
    const d = await deltas(w, () => entry(sc.connect(seller), 'release', w.sig(seller)).send());
    expect([d.buyer, d.fees, d.arbitrator]).toEqual([TERMS.amount, BCH_FEE, 0n]);
    expect(await sc.getBalance()).toBe(RESERVE_SATS);
    expect(await statusOf(sc)).toBe(Status.Released);
    for (const e of ['Funded', 'SellerCancelDisabled', 'Released']) expect(await eventCount(sc, e)).toBe(1);
  });

  it('B: token release pays tokens to the buyer and the fee recipient, and leaves the reserve unit', async () => {
    const w = await tokenWorld();
    const { seller, buyer, fees } = w.roles;
    const sc = await paidToken(w);
    const container = sc.getTokenContainerAddress(w.category);
    expect(await tokensAt(w.provider, container, w.category)).toBe(TOKEN.amount + TOKEN.fee + TOKEN.reserve);
    await entry(sc.connect(seller), 'release', w.sig(seller), w.category).send();
    expect(await tokensAt(w.provider, buyer.address, w.category)).toBe(TOKEN.amount);
    expect(await tokensAt(w.provider, fees.address, w.category)).toBe(TOKEN.fee);
    expect(await tokensAt(w.provider, container, w.category)).toBe(TOKEN.reserve);
    expect(await statusOf(sc)).toBe(Status.Released);
  });

  it('C: buyer cancel after mark as paid returns amount and fee to the seller', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const sc = await paidBch(w);
    const d = await deltas(w, () => entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer)).send());
    expect(d.seller).toBe(TERMS.amount + BCH_FEE);
    expect(d.fees).toBe(0n);
    expect(await sc.getBalance()).toBe(RESERVE_SATS);
    expect(await eventCount(sc, 'CancelledByBuyer')).toBe(1);
  });

  it('D: seller cancel after the waiting time returns amount and fee to the seller', async () => {
    const w = await world();
    const { seller } = w.roles;
    const sc = await openBch(w);
    await waitOut(w);
    const lockTime = await lockTimeNow(w);
    const d = await deltas(w, () => entry(sc.connect(seller), 'sellerCancel', w.sig(seller)).setLocktime(lockTime)
      .transfer(lockOf(seller.address), TERMS.amount + BCH_FEE).send());
    expect(d.buyer).toBe(0n);
    expect(d.fees).toBe(0n);
    expect(await sc.getBalance()).toBe(RESERVE_SATS);
    expect(await statusOf(sc)).toBe(Status.CancelledBySeller);
  });

  it('E: a one-sided dispute won by the buyer returns the buyer\'s dispute fee', async () => {
    const w = await world();
    const { buyer, arbitrator } = w.roles;
    const sc = await paidBch(w);
    await entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
    const d = await deltas(w, () => entry(sc.connect(arbitrator), 'resolveDispute', ...panelSigs(w), true).send());
    expect([d.buyer, d.fees, d.seller]).toEqual([TERMS.amount + TERMS.disputeFee, BCH_FEE, 0n]);
    expect(await sc.getBalance()).toBe(RESERVE_SATS);
    expect(await eventCount(sc, 'DisputeResolved')).toBe(1);
  });
});
