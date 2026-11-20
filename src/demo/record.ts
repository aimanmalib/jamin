// Writes a staged demo escrow into examples/mainnet.json (decision 0020): branch P, marked `demo`, so the site's
// "Release on mainnet" card finds it and Lifecycle lists it with the other mainnet escrows.
import type { MainnetEscrow, MainnetRecord, MainnetStep } from '../lifecycle/record.js';

export const DEMO_BRANCH = 'P';

/** The latest demo escrow of the record, if any. */
export function latestDemo(record: MainnetRecord): MainnetEscrow | undefined {
  return record.escrows.filter((e) => e.demo === true).at(-1);
}

/** Appends a staged demo escrow. Refuses an address or a txid the record already holds. */
export function addDemoEscrow(record: MainnetRecord, address: string, steps: MainnetStep[]): MainnetRecord {
  if (steps[0]?.step !== 'createEscrow') throw new Error('a demo escrow record starts with createEscrow');
  const known = new Set(record.escrows.flatMap((e) => e.steps.map((s) => ('txid' in s ? s.txid : s.rawTxHash))));
  if (record.escrows.some((e) => e.address === address)) throw new Error(`${address} is already recorded`);
  const repeated = steps.find((s) => known.has(s.txid));
  if (repeated) throw new Error(`${repeated.txid} is already recorded`);
  const escrow: MainnetEscrow = { branch: DEMO_BRANCH, asset: 'BCH', address, demo: true, steps: [...steps] };
  return { network: 'mainnet', escrows: [...record.escrows, escrow] };
}

/** The pool escrows (decision 0021) the record does not hold yet, oldest first. */
export function unrecordedPool<T extends { address: string }>(record: MainnetRecord, pool: T[]): T[] {
  const known = new Set(record.escrows.map((e) => e.address));
  return pool.filter((e) => !known.has(e.address));
}

/**
 * Adds a visitor's release (decision 0021) to a recorded demo escrow. Refuses an escrow that is not a recorded demo
 * escrow, one that already has a release, a step other than `release`, and a txid the record already holds.
 */
export function addDemoRelease(record: MainnetRecord, address: string, step: MainnetStep): MainnetRecord {
  if (step.step !== 'release') throw new Error('only a release step can be added to a demo escrow');
  const at = record.escrows.findIndex((e) => e.address === address && e.demo === true);
  if (at < 0) throw new Error(`${address} is not a recorded demo escrow`);
  const escrow = record.escrows[at] as MainnetEscrow;
  if (escrow.steps.some((s) => s.step === 'release')) throw new Error(`${address} already has a release`);
  const known = new Set(record.escrows.flatMap((e) => e.steps.map((s) => ('txid' in s ? s.txid : s.rawTxHash))));
  if (known.has(step.txid)) throw new Error(`${step.txid} is already recorded`);
  const escrows = record.escrows.map((e, i) => (i === at ? { ...e, steps: [...e.steps, step] } : e));
  return { network: 'mainnet', escrows };
}
