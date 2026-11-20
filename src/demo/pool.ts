// The pool of public demo escrows (docs/decisions/0021-demo-escrow-pool.md). A few demo escrows wait at `paid`, so
// one visitor's release does not end the demo for the next. scripts/demo-restage.ts runs `restage` from a host cron:
// it counts the escrows still waiting, and when there are fewer than `size`, before `restageUntil` and within the
// pool's own budget, takes back what the demo keys hold beyond the waiting escrows' fee coins and stages new ones.
// The pool's ledger is a file the cron writes (not tracked); the site reads only the list of escrow addresses.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PoolConfig } from './config.js';
import type { DemoStatus } from './escrow.js';
import type { Staged } from './stage.js';

export type { PoolConfig };

/** The wallet holds too little to stage: the pool waits for funds; not a failure, so no warning. */
export class FundsShort extends Error {}

export const POOL_LIMITS = { minSize: 3, maxSize: 5, maxBudgetSats: 400_000, maxEveryMinutes: 60 } as const;

export function validPool(p: PoolConfig): PoolConfig {
  const ints = [p.size, p.budgetSats, p.maxIndex, p.estimateSats, p.payFeeSats];
  if (!ints.every((n) => Number.isInteger(n) && n > 0)) throw new Error('pool values must be positive whole numbers');
  if (p.size < POOL_LIMITS.minSize || p.size > POOL_LIMITS.maxSize) throw new Error('pool size must be 3 to 5');
  if (p.budgetSats > POOL_LIMITS.maxBudgetSats) throw new Error(`pool budget must be at most ${POOL_LIMITS.maxBudgetSats} sats`);
  if (!Number.isInteger(p.restageEveryMinutes) || p.restageEveryMinutes < 1
    || p.restageEveryMinutes > POOL_LIMITS.maxEveryMinutes) throw new Error('pool restageEveryMinutes must be 1 to 60');
  if (!Number.isInteger(p.estimateReadyMinutes) || p.estimateReadyMinutes < 0) {
    throw new Error('pool estimateReadyMinutes must be a whole number, 0 or more');
  }
  if (Number.isNaN(Date.parse(p.restageUntil))) throw new Error('pool restageUntil must be an ISO date');
  if (!/^\/[a-z0-9/_-]+\.json$/.test(p.indexPath)) throw new Error('pool indexPath must be a site path to a .json file');
  return p;
}

export interface PoolEscrow {
  address: string;
  stagedAt: string;
  steps: { step: string; txid: string }[];
  extra: { what: string; txid: string }[];
  /** Paid to the demo keys, less the change back, plus the wallet's miner fees. */
  costSats: number;
}

export interface PoolLedger {
  spentSats: number;
  sweptSats: number;
  escrows: PoolEscrow[];
  sweeps: { at: string; txid: string; sats: number }[];
  /** Failed runs in a row. */
  failures: number;
  /** When each one-time warning was sent. */
  notified: { budget?: string; failures?: string };
}

export function emptyLedger(): PoolLedger {
  return { spentSats: 0, sweptSats: 0, escrows: [], sweeps: [], failures: 0, notified: {} };
}

export function readLedger(file: string): PoolLedger {
  if (!existsSync(file)) return emptyLedger();
  return { ...emptyLedger(), ...JSON.parse(readFileSync(file, 'utf8')) as Partial<PoolLedger> };
}

/** Writes through a temporary file and a rename, so a reader never sees half a file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export const netSpent = (l: PoolLedger): number => l.spentSats - l.sweptSats;

/** What the next staging is counted at: the configured estimate, or the dearest one measured if that is more. */
export function nextCost(pool: PoolConfig, l: PoolLedger): number {
  return Math.max(pool.estimateSats, ...l.escrows.map((e) => e.costSats));
}

export type Stop = 'full' | 'after-date' | 'budget' | 'max-index';

/** How many escrows to stage now, or why none. */
export function planRestage(pool: PoolConfig, l: PoolLedger, ready: number, now: Date): { stage: number; stop?: Stop } {
  if (ready >= pool.size) return { stage: 0, stop: 'full' };
  if (now.getTime() >= Date.parse(pool.restageUntil)) return { stage: 0, stop: 'after-date' };
  const cost = nextCost(pool, l);
  const byBudget = Math.max(0, Math.floor((pool.budgetSats - netSpent(l)) / cost));
  const byIndex = Math.max(0, pool.maxIndex - l.escrows.length);
  const want = pool.size - ready;
  const stage = Math.min(want, byBudget, byIndex);
  if (stage === want) return { stage };
  return { stage, stop: byIndex < want && byIndex <= byBudget ? 'max-index' : 'budget' };
}

/** The pool's cost of one staging, from what `stageDemo` measured. */
export function stagingCost(s: Pick<Staged, 'paidSats' | 'returnedSats' | 'payments'>, pool: PoolConfig): number {
  return Number(s.paidSats - s.returnedSats) + s.payments * pool.payFeeSats;
}

export interface RestageDeps {
  pool: PoolConfig;
  ledger: PoolLedger;
  now: Date;
  /** Demo escrow addresses recorded elsewhere (examples/mainnet.json); the ledger's own are added. */
  known: string[];
  status(address: string): Promise<DemoStatus>;
  /** Takes the demo keys' coins back to the wallet, keeping `keepSellerCoins` coins at the seller. */
  sweepBack(keepSellerCoins: number): Promise<{ txid: string; sats: bigint } | undefined>;
  stage(): Promise<Staged>;
  /** Counts and plans only: no sweep, no staging, no warning, no ledger change. */
  dry: boolean;
  notify(text: string): void;
  /** Fee coins each waiting escrow needs at the demo seller. */
  feeCoinsPerEscrow: number;
}

export interface RestageResult {
  ready: string[];
  staged: string[];
  swept?: { txid: string; sats: number };
  plan: { stage: number; stop?: Stop };
  ledger: PoolLedger;
  /** Set when the wallet could not pay for a staging (FundsShort); what was done before stays in the ledger. */
  waitingFunds?: string;
  /** Set when a sweep or staging failed otherwise; what was done before stays in the ledger. */
  failed?: string;
}

export const POOL_MESSAGES = {
  budget: 'Jamin: the demo escrow pool stopped staging: its budget (pool.budgetSats) is used up, its end date passed or it '
    + 'reached its escrow limit. The site offers the escrows still waiting, then shows released ones. No action needed.',
  failures: (error: string): string => `Jamin: the demo escrow pool failed 3 runs in a row. Last error: ${error}. `
    + 'Check the host cron log; undo with deploy/demo-restage-cron.sh buang.',
} as const;

/** Whether a later run could still stage an escrow: false once the budget, the end date or the escrow limit stops it. */
export function poolOpen(pool: PoolConfig, l: PoolLedger, now: Date): boolean {
  return planRestage(pool, l, 0, now).stage > 0;
}

/** What the site reads at pool.indexPath (web/demo/pick.ts parses it). */
export interface PoolIndex {
  updatedAt: string;
  /** When the cron last ran, and how often it runs: the card counts the minutes to the next staging from them. */
  lastRunAt: string;
  everyMinutes: number;
  /** No staging will follow (budget, end date, escrow limit), or the wallet is too short to pay for one: the card
   *  says the pool is closed instead of counting minutes. A later run that can stage again writes false. */
  closed: boolean;
  escrows: string[];
}

export function poolIndex(pool: PoolConfig, known: string[], l: PoolLedger, now: Date, waitingFunds = false): PoolIndex {
  const at = now.toISOString();
  return { updatedAt: at, lastRunAt: at, everyMinutes: pool.restageEveryMinutes,
    closed: waitingFunds || !poolOpen(pool, l, now),
    escrows: poolAddresses(known, l) };
}

/** Every demo escrow address the pool knows, oldest first, each once. */
export function poolAddresses(known: string[], l: PoolLedger): string[] {
  return [...new Set([...known, ...l.escrows.map((e) => e.address)])];
}

export async function restage(d: RestageDeps): Promise<RestageResult> {
  const ledger: PoolLedger = structuredClone(d.ledger);
  const ready: string[] = [];
  for (const a of poolAddresses(d.known, ledger)) if (await d.status(a) === 'paid') ready.push(a);
  const plan = planRestage(d.pool, ledger, ready.length, d.now);
  const result: RestageResult = { ready, staged: [], plan, ledger };
  if (d.dry) return result;
  if ((plan.stop === 'budget' || plan.stop === 'after-date' || plan.stop === 'max-index') && !ledger.notified.budget) {
    d.notify(POOL_MESSAGES.budget);
    ledger.notified.budget = d.now.toISOString();
  }
  if (plan.stage === 0) return result;

  try {
    const back = await d.sweepBack(ready.length * d.feeCoinsPerEscrow);
    if (back) {
      result.swept = { txid: back.txid, sats: Number(back.sats) };
      ledger.sweptSats += Number(back.sats);
      ledger.sweeps.push({ at: d.now.toISOString(), ...result.swept });
    }
    for (let i = 0; i < plan.stage; i += 1) {
      if (netSpent(ledger) + nextCost(d.pool, ledger) > d.pool.budgetSats) break;
      const s = await d.stage();
      const costSats = stagingCost(s, d.pool);
      ledger.spentSats += costSats;
      ledger.escrows.push({ address: s.address, stagedAt: new Date().toISOString(), steps: s.steps, extra: s.extra, costSats });
      result.staged.push(s.address);
    }
  } catch (error) {
    // Keep what was already swept and staged: those coins moved on chain and the ledger must count them.
    const msg = error instanceof Error ? error.message : String(error);
    if (error instanceof FundsShort) result.waitingFunds = msg;
    else result.failed = msg;
  }
  return result;
}

/** Counts a failed run; the third in a row sends one warning until a run succeeds again. */
export function recordFailure(l: PoolLedger, error: string, now: Date, notify: (text: string) => void): PoolLedger {
  const next = { ...l, failures: l.failures + 1, notified: { ...l.notified } };
  if (next.failures >= 3 && !next.notified.failures) {
    notify(POOL_MESSAGES.failures(error));
    next.notified.failures = now.toISOString();
  }
  return next;
}

export function recordSuccess(l: PoolLedger): PoolLedger {
  const notified = { ...l.notified };
  delete notified.failures;
  return { ...l, failures: 0, notified };
}
