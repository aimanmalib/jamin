// The arbitration panel: any two of three arbitrator keys decide a dispute (checkMultiSig). Each rejection here fails
// if the panel check it names is removed.
import { describe, expect, it } from 'vitest';
import {
  PANEL, TERMS, Status, deploy, entry, panelSigs, roleParams, satsAt, statusOf, tokensAt, world, type RoleName, type World,
} from './helpers/escrow.js';
import { BCH_FEE, TOKEN, disputedBch, disputedToken, tokenWorld } from './helpers/flows.js';

type Escrow = Awaited<ReturnType<typeof disputedBch>>;

// See test/JaminEscrow.state.test.ts: a failing constructor `require` is reported only as the VM failure (F8).
const CONSTRUCTOR_CHECK = /initial state commitments from constructor.*OP_VERIFY/;

function resolve(w: World, sc: Escrow, signers: readonly RoleName[], buyerWins = true): Promise<unknown> {
  return entry(sc.connect(w.roles.arbitrator), 'resolveDispute', ...panelSigs(w, signers), buyerWins).send();
}

async function expectRefused(w: World, sc: Escrow, attempt: Promise<unknown>): Promise<void> {
  await expect(attempt).rejects.toThrow(/NotArbitrator|OP_CHECKMULTISIG|NULLFAIL|signature/i);
  expect(await statusOf(sc)).toBe(Status.Disputed);
}

describe('JaminEscrow arbitration panel (2 of 3)', () => {
  const pairs: [RoleName, RoleName][] = [['arbitrator', 'arbiterB'], ['arbitrator', 'arbiterC'], ['arbiterB', 'arbiterC']];
  for (const pair of pairs) {
    it(`resolves with the signatures of ${pair.join(' and ')}`, async () => {
      const w = await world();
      const sc = await disputedBch(w);
      const before = await satsAt(w.provider, w.roles.buyer.address);
      await resolve(w, sc, pair);
      expect(await statusOf(sc)).toBe(Status.Resolved);
      expect(await satsAt(w.provider, w.roles.buyer.address) - before).toBe(TERMS.amount + TERMS.disputeFee);
    });
  }

  it('refuses one panel signature with an outsider signature', async () => {
    const w = await world();
    const sc = await disputedBch(w);
    await expectRefused(w, sc, resolve(w, sc, ['arbitrator', 'outsider']));
  });

  it('refuses the same panel signature given twice', async () => {
    const w = await world();
    const sc = await disputedBch(w);
    await expectRefused(w, sc, resolve(w, sc, ['arbiterB', 'arbiterB']));
  });

  it('refuses a trading party as the second signer', async () => {
    const w = await world();
    const sc = await disputedBch(w);
    await expectRefused(w, sc, resolve(w, sc, ['arbitrator', 'buyer']));
  });

  it('refuses two panel signatures out of panel key order', async () => {
    const w = await world();
    const sc = await disputedBch(w);
    await expectRefused(w, sc, resolve(w, sc, ['arbiterB', 'arbitrator']));
  });

  it('refuses Schnorr signatures, which OP_CHECKMULTISIG does not accept here', async () => {
    const w = await world();
    const { arbitrator, arbiterB } = w.roles;
    const sc = await disputedBch(w);
    await expectRefused(w, sc, entry(sc.connect(arbitrator), 'resolveDispute', w.sig(arbitrator), w.sig(arbiterB), true)
      .send());
  });

  for (const party of ['seller', 'buyer'] as const) {
    for (const [slot, name] of PANEL.entries()) {
      it(`refuses to create an escrow with the ${party} in panel slot ${'ABC'[slot]} (PartyOnPanel)`, async () => {
        const w = await world();
        const panel = PANEL.map((n) => (n === name ? party : n));
        await expect(deploy(w, 'JaminEscrow', roleParams(w.roles, panel),
          [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter])).rejects.toThrow(CONSTRUCTOR_CHECK);
      });
    }
  }

  it('runs with a single arbitrator who fills all three slots and signs once', async () => {
    const w = await world();
    const { seller, buyer, arbitrator } = w.roles;
    const single = ['arbitrator', 'arbitrator', 'arbitrator'] as const;
    const d = await deploy(w, 'JaminEscrow', roleParams(w.roles, single),
      [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
    await entry(d.sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount + BCH_FEE).send();
    await entry(d.sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
    await entry(d.sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
    const once = w.ecdsa(arbitrator);
    await entry(d.sc.connect(arbitrator), 'resolveDispute', once, once, false).send();
    expect(await statusOf(d.sc)).toBe(Status.Resolved);
  });

  it('refuses a panel member of a single-arbitrator escrow who is not that arbitrator', async () => {
    const w = await world();
    const { seller, buyer, arbiterB } = w.roles;
    const d = await deploy(w, 'JaminEscrow', roleParams(w.roles, ['arbitrator', 'arbitrator', 'arbitrator']),
      [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
    await entry(d.sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount + BCH_FEE).send();
    await entry(d.sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
    await entry(d.sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
    await expectRefused(w, d.sc, entry(d.sc.connect(arbiterB), 'resolveDispute', w.ecdsa(arbiterB), w.ecdsa(arbiterB),
      true).send());
  });
});

describe('JaminTokenEscrow arbitration panel (2 of 3)', () => {
  it('resolves for the seller with the signatures of panel members B and C', async () => {
    const w = await tokenWorld();
    const sc = await disputedToken(w);
    const before = await tokensAt(w.provider, w.roles.seller.address, w.category);
    await entry(sc.connect(w.roles.arbiterB), 'resolveDispute', ...panelSigs(w, ['arbiterB', 'arbiterC']), w.category,
      false).send();
    expect(await statusOf(sc)).toBe(Status.Resolved);
    expect(await tokensAt(w.provider, w.roles.seller.address, w.category) - before).toBe(TOKEN.amount + TOKEN.fee);
  });

  it('refuses one panel signature with an outsider signature', async () => {
    const w = await tokenWorld();
    const sc = await disputedToken(w);
    await expectRefused(w, sc, entry(sc.connect(w.roles.arbitrator), 'resolveDispute',
      ...panelSigs(w, ['arbitrator', 'outsider']), w.category, true).send());
  });
});
