import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Spending ledger for mainnet broadcasts. "Spent" means network fees plus any value that does not
 * return to an address of the test wallet. Every broadcast is checked against the budget first and
 * recorded after it is accepted.
 */
export interface SpendEntry {
  at: string;
  network: 'mainnet';
  txid: string;
  spentSats: number;
  note: string;
}

export interface Ledger {
  entries: SpendEntry[];
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentSats: number,
    readonly plannedSats: number,
    readonly budgetSats: number,
  ) {
    super(`budget exceeded: spent ${spentSats} + planned ${plannedSats} > budget ${budgetSats} sat; not broadcasting`);
    this.name = 'BudgetExceededError';
  }
}

function assertSats(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a non-negative integer number of sats`);
}

export function readLedger(file: string): Ledger {
  if (!existsSync(file)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Ledger>;
  if (!Array.isArray(parsed.entries)) throw new Error(`ledger ${file} has no entries array`);
  for (const e of parsed.entries) assertSats(e.spentSats, 'ledger entry spentSats');
  return { entries: parsed.entries };
}

export function totalSpent(ledger: Ledger): number {
  return ledger.entries.reduce((sum, e) => sum + e.spentSats, 0);
}

/** Throws BudgetExceededError when spending plannedSats more would pass the budget. */
export function checkBudget(ledger: Ledger, budgetSats: number, plannedSats: number): void {
  assertSats(budgetSats, 'budgetSats');
  assertSats(plannedSats, 'plannedSats');
  const spent = totalSpent(ledger);
  if (spent + plannedSats > budgetSats) throw new BudgetExceededError(spent, plannedSats, budgetSats);
}

export function recordSpend(file: string, entry: Omit<SpendEntry, 'at'> & { at?: string }): Ledger {
  assertSats(entry.spentSats, 'spentSats');
  if (!/^[0-9a-f]{64}$/.test(entry.txid)) throw new Error('txid must be 64 lowercase hex characters');
  const ledger = readLedger(file);
  if (ledger.entries.some((e) => e.txid === entry.txid)) return ledger;
  const next: Ledger = { entries: [...ledger.entries, { ...entry, at: entry.at ?? new Date().toISOString() }] };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  return next;
}
