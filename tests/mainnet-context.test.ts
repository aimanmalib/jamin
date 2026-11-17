// The mainnet lifecycle context, run on the SolidCash mock network (production profile) behind the spending gate:
// every broadcast is checked and recorded, the budget refuses before sending, branch D stops at its waiting time and
// a later run finishes it from the recorded address, and the token branch splits a larger token coin or is skipped.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { gateProvider, type GateOptions } from '../src/budget/gate.js';
import { readLedger, totalSpent } from '../src/budget/ledger.js';
import { branchA, branchB } from '../src/lifecycle/branches.js';
import { lockOf, satsAt, type PartyName, type Terms } from '../src/lifecycle/context.js';
import { NoTokenError, walletContext, type WalletOptions } from '../src/lifecycle/mainnet.js';
import { runBranches } from '../src/lifecycle/mainnet-run.js';
import { loadPending } from '../src/lifecycle/record.js';
import { asProvider } from '../src/sdk/mock.js';

const TERMS: Terms = { amount: 20_000n, tokenAmount: 100n, feeBps: 30n, disputeFee: 5_000n, waitSeconds: 3_600n,
  reserve: 1_000n };

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jamin-gate-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

async function setup(budgetSats: number, tokenCategory = '00'.repeat(32)) {
  const mock = new MockNetworkProvider({ profile: 'production' });
  const [s, b, a, f] = await mock.getSigners(4);
  if (!s || !b || !a || !f) throw new Error('mock signers missing');
  const keys: Record<PartyName, Uint8Array> = { seller: s.privateKey, buyer: b.privateKey, arbitrator: a.privateKey,
    fees: f.privateKey };
  const gate: GateOptions = {
    ledgerFile: join(dir, 'belanja.json'), budgetSats, note: 'test',
    walletLocks: new Set([s, b, a, f].map((x) => binToHex(lockOf(x.address)))),
    prevout: async (txid, vout) => {
      const out = await mock.getLedgerOutput(txid, vout);
      if (!out) throw new Error(`no live output ${txid}:${vout}`);
      return out;
    },
  };
  const opts: WalletOptions = { network: 'mock', provider: gateProvider(asProvider(mock), gate), keys, terms: TERMS,
    tokenCategory, genesisCoinSats: 50_000n, partyFloatSats: 40_000n, feeRate: 1 };
  return { mock, gate, opts, seller: s };
}

describe('mainnet context behind the spending gate', { timeout: 180_000 }, () => {
  it('runs branch A and records every broadcast in the ledger', async () => {
    const { opts, gate } = await setup(2_000_000);
    const { ctx, steps } = await walletContext(opts);
    await branchA(ctx);
    expect(steps.map((s) => s.step)).toEqual(['createEscrow', 'fund', 'markAsPaid', 'release']);
    const ledger = readLedger(gate.ledgerFile);
    const recorded = new Set(ledger.entries.map((e) => e.txid));
    for (const s of steps) expect(recorded.has(s.txid)).toBe(true);
    // The escrow's reserve stays behind and network fees are paid; the release back to the wallet is not credited.
    expect(totalSpent(ledger)).toBeGreaterThan(Number(TERMS.reserve));
    expect(totalSpent(ledger)).toBeLessThan(200_000);
  });

  it('refuses before broadcasting when the budget would be passed', async () => {
    const { opts, gate, mock, seller } = await setup(100);
    const before = await satsAt(asProvider(mock), seller.address);
    const { ctx } = await walletContext(opts);
    // The SDK passes the gate's error on wrapped in its own, keeping the message.
    await expect(branchA(ctx)).rejects.toThrow(/budget exceeded: spent 0 \+ planned \d+ > budget 100 sat/);
    expect(readLedger(gate.ledgerFile).entries).toEqual([]);
    expect(await satsAt(asProvider(mock), seller.address)).toBe(before);
  });

  it('runs D across two runs: the first records it as pending, a run after the waiting time finishes it', async () => {
    const { opts, mock } = await setup(2_000_000);
    const pendingFile = join(dir, 'pending.json');
    const first = await walletContext(opts);
    const r1 = await runBranches(first.ctx, first.steps, ['D', 'B'], pendingFile);
    expect(r1.failures).toEqual([]);
    expect(r1.waitingUntil).toBeGreaterThan(0n);
    expect(r1.skipped).toHaveLength(1);
    expect(loadPending(pendingFile)?.steps.map((s) => s.step)).toEqual(['createEscrow', 'fund']);
    const early = await walletContext(opts);
    expect((await runBranches(early.ctx, early.steps, ['D'], pendingFile)).waitingUntil).toBe(r1.waitingUntil);
    expect(early.steps).toEqual([]);
    mock.increaseTime(TERMS.waitSeconds + 7_200n);
    const later = await walletContext(opts);
    const r2 = await runBranches(later.ctx, later.steps, ['D'], pendingFile);
    expect(r2.failures).toEqual([]);
    expect(r2.waitingUntil).toBeUndefined();
    expect(later.steps.map((s) => s.step)).toEqual(['sellerCancel']);
    expect(loadPending(pendingFile)).toBeUndefined();
  });

  it('splits a larger token coin for the token branch and refuses without one', async () => {
    const probe = await setup(2_000_000);
    await expect(walletContext(probe.opts).then((r) => r.ctx.tokenCoin(10n))).rejects.toBeInstanceOf(NoTokenError);
    const { mock, opts, seller } = probe;
    const minted = await mock.addTokenUtxos([{ address: seller.address, satoshis: 1_000n, token: { amount: 500n } }]);
    const { ctx, steps } = await walletContext({ ...opts, tokenCategory: minted.categoryId });
    await branchB(ctx);
    expect(steps.map((s) => s.step)).toEqual(['createEscrow', 'deposit', 'markAsPaid', 'release']);
  });
});
