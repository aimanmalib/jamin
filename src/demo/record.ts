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
