import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BudgetExceededError, checkBudget, readLedger, recordSpend, totalSpent } from '../src/budget/ledger.js';

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jamin-ledger-'));
  file = join(dir, 'state', 'ledger.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('spending ledger', () => {
  it('starts empty when the file does not exist', () => {
    expect(totalSpent(readLedger(file))).toBe(0);
  });

  it('records spends and sums them, ignoring a repeated txid', () => {
    recordSpend(file, { network: 'mainnet', txid: TXID_A, spentSats: 400, note: 'create' });
    recordSpend(file, { network: 'mainnet', txid: TXID_B, spentSats: 600, note: 'release' });
    recordSpend(file, { network: 'mainnet', txid: TXID_A, spentSats: 400, note: 'create again' });
    expect(totalSpent(readLedger(file))).toBe(1000);
  });

  it('allows a spend that lands exactly on the budget', () => {
    recordSpend(file, { network: 'mainnet', txid: TXID_A, spentSats: 1500, note: 'x' });
    expect(() => checkBudget(readLedger(file), 2000, 500)).not.toThrow();
  });

  it('refuses a spend that would pass the budget', () => {
    recordSpend(file, { network: 'mainnet', txid: TXID_A, spentSats: 1500, note: 'x' });
    expect(() => checkBudget(readLedger(file), 2000, 501)).toThrow(BudgetExceededError);
  });

  it('rejects negative or fractional amounts and malformed txids', () => {
    expect(() => checkBudget({ entries: [] }, 2000, -1)).toThrow();
    expect(() => checkBudget({ entries: [] }, 2000, 0.5)).toThrow();
    expect(() => recordSpend(file, { network: 'mainnet', txid: 'nothex', spentSats: 1, note: 'x' })).toThrow();
  });
});
