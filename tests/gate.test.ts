// The spending gate on its own: what a transaction takes out of the wallet, read from the raw transactions its inputs
// spend (the mainnet path), and the refusal of every way of publishing that skips the budget check.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex, encodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateProvider, prevoutsFrom, walletSpend } from '../src/budget/gate.js';
import { readLedger, recordSpend, totalSpent } from '../src/budget/ledger.js';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jamin-gate-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const WALLET = hexToBin('76a914' + '11'.repeat(20) + '88ac');
const OTHER = hexToBin('a914' + '22'.repeat(20) + '87');
const out = (lockingBytecode: Uint8Array, valueSatoshis: bigint) => ({ lockingBytecode, valueSatoshis });
const input = (txid: string, outpointIndex: number) =>
  ({ outpointTransactionHash: hexToBin(txid), outpointIndex, sequenceNumber: 0, unlockingBytecode: new Uint8Array() });
const raw = (inputs: ReturnType<typeof input>[], outputs: ReturnType<typeof out>[]): string =>
  binToHex(encodeTransaction({ version: 2, locktime: 0, inputs, outputs }));

describe('wallet spend', () => {
  const prevTxid = 'ab'.repeat(32);
  const prev = raw([input('00'.repeat(32), 0)], [out(OTHER, 7_000n), out(WALLET, 50_000n)]);
  const provider = { getRawTransaction: (txid: string) =>
    txid === prevTxid ? Promise.resolve(prev) : Promise.reject(new Error(`unknown ${txid}`)) };
  const locks = new Set([binToHex(WALLET)]);

  it('counts wallet inputs read from raw transactions, minus change back to the wallet', async () => {
    const tx = raw([input(prevTxid, 1)], [out(OTHER, 21_000n), out(WALLET, 28_700n)]);
    expect(await walletSpend(tx, locks, prevoutsFrom(provider))).toBe(50_000 - 28_700);
  });

  it('does not count coins that were not the wallet\'s and never goes below zero', async () => {
    const tx = raw([input(prevTxid, 0)], [out(WALLET, 6_500n)]);
    expect(await walletSpend(tx, locks, prevoutsFrom(provider))).toBe(0);
  });
});

describe('spending gate', () => {
  it('refuses a broadcast sent around sendRawTransaction', () => {
    const inner = { performRequest: (name: string) => name } as never;
    const gated = gateProvider(inner, { ledgerFile: join(dir, 'l.json'), budgetSats: 1, walletLocks: new Set(),
      note: 'test', prevout: () => Promise.reject(new Error('unused')) }) as unknown as {
      performRequest: (name: string, ...a: unknown[]) => unknown };
    expect(() => gated.performRequest('blockchain.transaction.broadcast', '00')).toThrow(/budget check/);
    expect(gated.performRequest('blockchain.headers.subscribe')).toBe('blockchain.headers.subscribe');
    const other = gateProvider({ publishOraclePoolTransaction: () => 'sent' } as never, { ledgerFile: join(dir, 'l.json'),
      budgetSats: 1, walletLocks: new Set(), note: 'test' }) as unknown as { publishOraclePoolTransaction: () => unknown };
    expect(() => other.publishOraclePoolTransaction()).toThrow(/not gated/);
  });

  it('records a refused broadcast as a 0 sat attempt, which a later accepted one does not hide', async () => {
    const ledgerFile = join(dir, 'refused.json');
    recordSpend(ledgerFile, { network: 'mainnet', txid: 'ab'.repeat(32), spentSats: 900, note: 'earlier' });
    const hex = raw([input('cd'.repeat(32), 0)], [out(OTHER, 500n)]);
    let accept = false;
    const inner = { sendRawTransaction: (h: string) => (accept ? Promise.resolve(hashTransaction(hexToBin(h)))
      : Promise.reject(new Error('mandatory-script-verify-flag-failed (code 16)'))) };
    // The budget is spent to the last satoshi: an attempt that takes nothing out of the wallet still goes through.
    const gated = gateProvider(inner as never, { ledgerFile, budgetSats: 900, walletLocks: new Set([binToHex(WALLET)]),
      note: 'branch R', prevout: () => Promise.resolve({ lockingBytecode: OTHER, satoshis: 600n }) }) as unknown as {
      sendRawTransaction: (h: string) => Promise<string> };
    await expect(gated.sendRawTransaction(hex)).rejects.toThrow(/code 16/);
    const after = readLedger(ledgerFile);
    expect(totalSpent(after)).toBe(900);
    expect(after.entries[1]).toMatchObject({ txid: hashTransaction(hexToBin(hex)), spentSats: 0, refused: true });
    expect(after.entries[1]?.note).toMatch(/^branch R: refused: mandatory-script-verify-flag-failed/);
    accept = true;
    await gated.sendRawTransaction(hex);
    expect(readLedger(ledgerFile).entries.map((e) => e.refused ?? false)).toEqual([false, true, false]);
  });

  it('records nothing for a transaction taken before it was broadcast', async () => {
    const ledgerFile = join(dir, 'captured.json');
    const taken = Object.assign(new Error('taken'), { name: 'CapturedTransaction' });
    const gated = gateProvider({ sendRawTransaction: () => Promise.reject(taken) } as never, { ledgerFile, budgetSats: 1,
      walletLocks: new Set(), note: 'test', prevout: () => Promise.resolve({ lockingBytecode: OTHER, satoshis: 1n }) }) as
      unknown as { sendRawTransaction: (h: string) => Promise<string> };
    await expect(gated.sendRawTransaction(raw([input('ef'.repeat(32), 1)], [out(OTHER, 1n)]))).rejects.toBe(taken);
    expect(readLedger(ledgerFile).entries).toEqual([]);
  });
});
