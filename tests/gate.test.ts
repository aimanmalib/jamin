// The spending gate on its own: what a transaction takes out of the wallet, read from the raw transactions its inputs
// spend (the mainnet path), and the refusal of every way of publishing that skips the budget check.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex, encodeTransaction, hexToBin } from '@bitauth/libauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateProvider, prevoutsFrom, walletSpend } from '../src/budget/gate.js';

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
});
