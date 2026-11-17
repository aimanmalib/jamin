// BCH escrow rejections: each test fails if the contract check it names is removed.
import { describe, expect, it } from 'vitest';
import {
  TERMS, Status, deploy, entry, lockOf, lockTimeNow, roleParams, satsAt, statusOf, tooEarly, world, type World,
} from './helpers/escrow.js';

const FEE = 600n; // 30 bps of 200,000 sats
const INIT = [TERMS.amount, TERMS.feeBps, TERMS.disputeFee];

async function open(w: World): Promise<Awaited<ReturnType<typeof deploy>>> {
  const { seller } = w.roles;
  const d = await deploy(w, 'JaminEscrow', roleParams(w.roles), [...INIT, w.cancelAfter]);
  await entry(d.sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount + FEE).send();
  return d;
}

async function paid(w: World): Promise<Awaited<ReturnType<typeof deploy>>> {
  const { buyer } = w.roles;
  const d = await open(w);
  await entry(d.sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
  return d;
}

async function disputed(w: World): Promise<Awaited<ReturnType<typeof deploy>>> {
  const { buyer } = w.roles;
  const d = await paid(w);
  await entry(d.sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
  return d;
}

async function waitOut(w: World): Promise<void> {
  w.provider.increaseTime(TERMS.waitSeconds + 60n);
  await w.provider.mine(1);
}

function sellerCancel(w: World, sc: Awaited<ReturnType<typeof deploy>>['sc'], lockTime: number): Promise<unknown> {
  const { seller } = w.roles;
  return entry(sc.connect(seller), 'sellerCancel', w.sig(seller)).setLocktime(lockTime)
    .transfer(lockOf(seller.address), TERMS.amount + FEE).send();
}

describe('JaminEscrow (BCH) rejections', () => {
  it('rejects a seller cancel before the waiting time (TooEarly)', async () => {
    const w = await world();
    const { sc } = await open(w);
    await expect(sellerCancel(w, sc, await lockTimeNow(w))).rejects.toThrow(tooEarly(w));
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a seller cancel after mark as paid, even after the waiting time (AlreadyMarkedPaid)', async () => {
    const w = await world();
    const { sc } = await paid(w);
    await waitOut(w);
    await expect(sellerCancel(w, sc, await lockTimeNow(w))).rejects.toThrow(/AlreadyMarkedPaid/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  for (const role of ['buyer', 'seller', 'outsider'] as const) {
    it(`rejects a dispute resolution signed by the ${role} (NotArbitrator)`, async () => {
      const w = await world();
      const signer = w.roles[role];
      const { sc } = await disputed(w);
      await expect(entry(sc.connect(signer), 'resolveDispute', w.sig(signer), true).send())
        .rejects.toThrow(/NotArbitrator/);
      expect(await statusOf(sc)).toBe(Status.Disputed);
    });
  }

  it('rejects a dispute before the buyer marked it paid (NotPaid)', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const { sc } = await open(w);
    await expect(entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send())
      .rejects.toThrow(/NotPaid/);
    expect(await statusOf(sc)).toBe(Status.Funded);
  });

  it('rejects a dispute with the wrong dispute fee (WrongDisputeFee)', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const { sc } = await paid(w);
    await expect(entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee - 1n)
      .send()).rejects.toThrow(/WrongDisputeFee/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('rejects a second dispute fee from the same side (AlreadyPaidDispute)', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const { sc } = await disputed(w);
    await expect(entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send())
      .rejects.toThrow(/AlreadyPaidDispute/);
  });

  it('rejects a release once disputed (NotOpen)', async () => {
    const w = await world();
    const { seller } = w.roles;
    const { sc } = await disputed(w);
    await expect(entry(sc.connect(seller), 'release', w.sig(seller)).send()).rejects.toThrow(/NotOpen/);
    expect(await statusOf(sc)).toBe(Status.Disputed);
  });

  it('rejects a buyer cancel once disputed (NotOpen)', async () => {
    const w = await world();
    const { buyer } = w.roles;
    const { sc } = await disputed(w);
    await expect(entry(sc.connect(buyer), 'buyerCancel', w.sig(buyer)).send()).rejects.toThrow(/NotOpen/);
    expect(await statusOf(sc)).toBe(Status.Disputed);
  });

  it('pays the seller back in full when the buyer alone disputed and lost', async () => {
    const w = await world();
    const { seller, arbitrator, fees } = w.roles;
    const { sc } = await disputed(w);
    const sellerBefore = await satsAt(w.provider, seller.address);
    const feesBefore = await satsAt(w.provider, fees.address);
    await entry(sc.connect(arbitrator), 'resolveDispute', w.sig(arbitrator), false).send();
    expect(await satsAt(w.provider, seller.address) - sellerBefore).toBe(TERMS.amount + FEE);
    expect(await satsAt(w.provider, fees.address) - feesBefore).toBe(TERMS.disputeFee);
  });
});
