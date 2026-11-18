// The browser simulator's engine, run in Node against the compiled artifacts: the five lifecycle branches and the
// named rejections a visitor sees when the wrong role acts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@solidcash/solidcash';
import { Simulation, type Artifacts, type SimTerms } from '../web/sim/engine.js';
import { rejectionName } from '../web/sim/errors.js';

const load = (n: string): Artifact => JSON.parse(readFileSync(`artifacts/solidcash/${n}.json`, 'utf8')) as Artifact;
const artifacts: Artifacts = { bch: load('JaminEscrow'), token: load('JaminTokenEscrow') };
const BCH: SimTerms = { amount: 20_000n, feeBps: 30n, disputeFee: 5_000n, waitSeconds: 3_600n, reserve: 1_000n };
const TOKEN: SimTerms = { ...BCH, amount: 200n };

describe('simulator engine', { timeout: 120_000 }, () => {
  it('A: releases a BCH escrow after the buyer marks it paid', async () => {
    const sim = await Simulation.start(artifacts, 'bch', BCH);
    expect(await sim.status()).toBe('funded');
    expect((await sim.act('buyer', 'markAsPaid')).ok).toBe(true);
    expect((await sim.act('seller', 'release')).ok).toBe(true);
    expect(await sim.status()).toBe('released');
    expect(sim.log.map((l) => l.action)).toEqual(['createEscrow', 'fund', 'markAsPaid', 'release']);
  });

  it('B: releases a token escrow', async () => {
    const sim = await Simulation.start(artifacts, 'token', TOKEN);
    expect(sim.log[1]?.action).toBe('deposit');
    await sim.act('buyer', 'markAsPaid');
    expect((await sim.act('seller', 'release')).ok).toBe(true);
    expect(await sim.status()).toBe('released');
  });

  it('C: the buyer cancels', async () => {
    const sim = await Simulation.start(artifacts, 'bch', BCH);
    const r = await sim.act('buyer', 'buyerCancel');
    expect(r.ok).toBe(true);
    expect(await sim.status()).toBe('cancelledByBuyer');
  });

  it('D: the seller cancels only after the waiting time', async () => {
    const sim = await Simulation.start(artifacts, 'bch', BCH);
    expect(await sim.waitLeft()).toBeGreaterThan(0);
    expect(await sim.act('seller', 'sellerCancel')).toMatchObject({ ok: false, error: 'TooEarly' });
    await sim.passTime();
    expect(await sim.waitLeft()).toBe(0);
    expect((await sim.act('seller', 'sellerCancel')).ok).toBe(true);
    expect(await sim.status()).toBe('cancelledBySeller');
  });

  it('E: a dispute resolved for the buyer, with named rejections on the way', async () => {
    const sim = await Simulation.start(artifacts, 'bch', BCH);
    expect(await sim.act('buyer', 'openDispute')).toMatchObject({ ok: false, error: 'NotPaid' });
    expect(await sim.act('seller', 'markAsPaid')).toMatchObject({ ok: false, error: 'NotBuyer' });
    await sim.act('buyer', 'markAsPaid');
    expect((await sim.act('buyer', 'openDispute')).ok).toBe(true);
    expect(await sim.status()).toBe('disputed');
    expect(await sim.act('buyer', 'resolveForBuyer')).toMatchObject({ ok: false, error: 'NotArbitrator',
      signers: ['buyer', 'buyer'] });
    expect(await sim.act('arbitrator', 'resolveForBuyer')).toMatchObject({ ok: true, signers: ['panelA', 'panelB'] });
    expect(await sim.status()).toBe('resolved');
  });

  it('E: one panel signature is not enough; two of the three decide', async () => {
    const sim = await Simulation.start(artifacts, 'bch', BCH);
    await sim.act('buyer', 'markAsPaid');
    await sim.act('seller', 'openDispute');
    expect(await sim.act('arbitrator', 'resolveForSeller', 'none')).toMatchObject({ ok: false,
      error: 'NotArbitrator', signers: ['panelA', 'panelA'] });
    expect(await sim.status()).toBe('disputed');
    expect(await sim.act('arbitrator', 'resolveForSeller', 'B')).toMatchObject({ ok: true,
      signers: ['panelA', 'panelB'] });
    expect(await sim.status()).toBe('resolved');
    expect(sim.log.filter((l) => l.action !== 'resolveForSeller').every((l) => l.signers === undefined)).toBe(true);
  });

  it('W: a seller trading from a wallet funds, cancels after the waiting time and releases another trade', async () => {
    const text = { template: 'Role {role} at {site} for {trade}', site: 'jamin.example', trade: 'w' };
    const sim = await Simulation.start(artifacts, 'bch', BCH, 'wallet', text);
    expect(sim.seller.message).toBe('Role seller at jamin.example for w');
    expect(sim.log.map((l) => l.walletInputs)).toEqual([1, 1]);
    await sim.passTime();
    const cancel = await sim.act('seller', 'sellerCancel');
    expect(cancel.ok).toBe(true);
    expect(cancel.walletInputs).toBeGreaterThan(0);
    const token = await Simulation.start(artifacts, 'token', TOKEN, 'wallet', text);
    await token.act('buyer', 'markAsPaid');
    expect((await token.act('seller', 'release')).ok).toBe(true);
    expect(await token.status()).toBe('released');
  });
});

describe('rejectionName', () => {
  it('names the contract error, maps a locktime failure to TooEarly and falls back to Rejected', () => {
    expect(rejectionName('Script failed: NotSeller() at EscrowBase.scash:52')).toBe('NotSeller');
    expect(rejectionName('required locktime: 1700000000')).toBe('TooEarly');
    expect(rejectionName('mempool conflict')).toBe('Rejected');
    expect(rejectionName('NotSellerX')).toBe('Rejected');
  });
});
