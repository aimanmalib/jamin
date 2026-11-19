// Branch T as a mainnet run plays it (decision 0019), on the SolidCash mock network behind the spending gate: the
// token units earlier branches left at the buyer and the fee recipient come back to the seller in one coin, the
// escrow is created and funded with them, and the buyer's cancel reaches the network only through a relayer that
// reads the two files the buyer wrote. The record keeps the asset and marks the relayed step.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { gateProvider } from '../src/budget/gate.js';
import { readLedger } from '../src/budget/ledger.js';
import { lockOf, tokensAt, type PartyName, type Relayer, type Terms } from '../src/lifecycle/context.js';
import { walletContext } from '../src/lifecycle/mainnet.js';
import { runBranches } from '../src/lifecycle/mainnet-run.js';
import { addSteps } from '../src/lifecycle/record.js';
import { relay, type RelayIntent } from '../src/relay/relay.js';
import { asProvider } from '../src/sdk/mock.js';
import { runSettings } from '../scripts/lifecycle-mainnet.js';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jamin-relay-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const M = { tokenAmount: 10, genesisCoinSats: 50_000, partyFloatSats: 40_000,
  branchTerms: { T: { tokenAmount: 9, genesisCoinSats: 20_000, partyFloatSats: 15_000, floatParties: ['buyer' as const] } } };

describe('mainnet run settings', () => {
  it('takes a branch\'s own settings only when the run has that one branch', () => {
    expect(runSettings(M, ['T'])).toEqual({ tokenAmount: 9, genesisCoinSats: 20_000, partyFloatSats: 15_000,
      floatParties: ['buyer'] });
    for (const wanted of [['B'], ['T', 'B'], []]) {
      expect(runSettings(M, wanted)).toEqual({ tokenAmount: 10, genesisCoinSats: 50_000, partyFloatSats: 40_000,
        floatParties: ['buyer', 'arbitrator'] });
    }
  });
});

describe('branch T in a mainnet run', { timeout: 300_000 }, () => {
  it('gathers the token units, funds the escrow and sends the buyer\'s cancel through the relayer', async () => {
    const mock = new MockNetworkProvider({ profile: 'production' });
    const [s, b, a, f, a2, a3] = await mock.getSigners(6);
    if (!s || !b || !a || !f || !a2 || !a3) throw new Error('mock signers missing');
    const keys: Record<PartyName, Uint8Array> = { seller: s.privateKey, buyer: b.privateKey, arbitrator: a.privateKey,
      arbiterB: a2.privateKey, arbiterC: a3.privateKey, fees: f.privateKey };
    // As on mainnet after branch B: ten units at the buyer, one at the fee recipient, none at the seller.
    const minted = await mock.addTokenUtxos([{ address: b.address, satoshis: 1_200n, token: { amount: 10n } },
      { address: f.address, satoshis: 1_200n, token: { amount: 1n } }]);
    const category = minted.categoryId;
    const ledgerFile = join(dir, 'belanja.json');
    const provider = gateProvider(asProvider(mock), { ledgerFile, budgetSats: 2_000_000, note: 'test',
      walletLocks: new Set([s, b, a, f, a2, a3].map((x) => binToHex(lockOf(x.address)))),
      prevout: async (txid, vout) => {
        const out = await mock.getLedgerOutput(txid, vout);
        if (!out) throw new Error(`no live output ${txid}:${vout}`);
        return out;
      } });
    const set = runSettings(M, ['T']);
    const terms: Terms = { amount: 20_000n, tokenAmount: BigInt(set.tokenAmount), feeBps: 30n, disputeFee: 5_000n,
      waitSeconds: 3_600n, reserve: 1_000n };
    const { ctx, steps } = await walletContext({ network: 'mock', provider, keys, terms, tokenCategory: category,
      genesisCoinSats: BigInt(set.genesisCoinSats), partyFloatSats: BigInt(set.partyFloatSats),
      floatParties: set.floatParties, feeRate: 1 });
    const read: string[] = [];
    const relayer: Relayer = {
      dir,
      async send(txFile, intentFile) {
        read.push(txFile, intentFile);
        const intent = JSON.parse(readFileSync(intentFile, 'utf8')) as RelayIntent;
        return relay(readFileSync(txFile, 'utf8').trim(), intent, (h) => provider.sendRawTransaction(h));
      },
    };
    ctx.relayer = relayer;

    const result = await runBranches(ctx, steps, ['T'], join(dir, 'pending.json'));
    expect(result.failures).toEqual([]);
    expect(steps.map((x) => [x.step, x.relayed])).toEqual([['createEscrow', undefined], ['deposit', undefined],
      ['buyerCancel', true]]);
    expect(read.map((p) => p.slice(dir.length + 1))).toEqual(['T-buyerCancel.hex', 'T-buyerCancel.intent.json']);
    // Nine units and the one-unit fee are back with the seller; the reserve unit stays in the token container.
    expect(await tokensAt(provider, s.address, category)).toBe(10n);
    expect(await tokensAt(provider, b.address, category)).toBe(0n);
    const recorded = new Set(readLedger(ledgerFile).entries.map((e) => e.txid));
    for (const x of steps) expect(recorded.has(x.txid)).toBe(true);

    const record = addSteps({ network: 'mainnet', escrows: [] }, steps);
    expect(record.escrows.map((e) => e.asset)).toEqual(['PUSD']);
    expect(record.escrows[0]?.steps.map((x) => ('relayed' in x ? x.relayed : undefined)))
      .toEqual([undefined, undefined, true]);
  });
});
