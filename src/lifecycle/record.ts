// What a mainnet run keeps between runs and what it publishes: the D escrow that waits for its seller-cancel time,
// and examples/mainnet.json, every mainnet escrow with its transactions in the shape the web app reads.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PendingD } from './branches.js';
import type { Step } from './context.js';

export interface SavedPending { address: string; fee: string; after: string; steps: Step[] }

function writeAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export function savePending(file: string, d: PendingD, steps: Step[]): void {
  writeAtomic(file, { address: d.address, fee: d.fee.toString(), after: d.after.toString(), steps });
}

export function loadPending(file: string): { d: PendingD; steps: Step[] } | undefined {
  if (!existsSync(file)) return undefined;
  const s = JSON.parse(readFileSync(file, 'utf8')) as SavedPending;
  return { d: { address: s.address, fee: BigInt(s.fee), after: BigInt(s.after) }, steps: s.steps };
}

export function clearPending(file: string): void {
  rmSync(file, { force: true });
}

export interface MainnetStep {
  step: string; txid: string; height?: number; signer?: 'wallet'; txBytes?: number; feeSats?: number;
}
export interface MainnetEscrow { branch: string; asset: string; address?: string; steps: MainnetStep[] }
export interface MainnetRecord { network: 'mainnet'; escrows: MainnetEscrow[] }

/** The asset each branch trades. */
export const BRANCH_ASSET: Record<string, string> = { A: 'BCH', B: 'PUSD', C: 'BCH', D: 'BCH', E: 'BCH', W: 'BCH' };

/**
 * Adds the steps of one escrow to the record. A branch's steps start a new escrow at `createEscrow`; steps without
 * one (D finished in a later run) join the latest escrow of that branch. A txid already recorded is not repeated.
 */
export function addSteps(record: MainnetRecord,
  steps: Array<Step & { height?: number; txBytes?: number; feeSats?: number }>): MainnetRecord {
  const escrows = record.escrows.map((e) => ({ ...e, steps: [...e.steps] }));
  const known = new Set(escrows.flatMap((e) => e.steps.map((s) => s.txid)));
  for (const s of steps) {
    if (known.has(s.txid)) continue;
    known.add(s.txid);
    const row: MainnetStep = { step: s.step, txid: s.txid, ...(s.height === undefined ? {} : { height: s.height }),
      ...(s.signer === undefined ? {} : { signer: s.signer }),
      ...(s.txBytes === undefined ? {} : { txBytes: s.txBytes }),
      ...(s.feeSats === undefined ? {} : { feeSats: s.feeSats }) };
    const latest = [...escrows].reverse().find((e) => e.branch === s.branch);
    if (s.step === 'createEscrow' || !latest) {
      escrows.push({ branch: s.branch, asset: BRANCH_ASSET[s.branch] ?? 'BCH',
        ...(s.escrow === undefined ? {} : { address: s.escrow }), steps: [row] });
    } else {
      latest.steps.push(row);
    }
  }
  return { network: 'mainnet', escrows };
}

/** Txids recorded without a block height (still in the mempool when their run wrote them). */
export function unmined(record: MainnetRecord): string[] {
  return record.escrows.flatMap((e) => e.steps.filter((s) => s.height === undefined).map((s) => s.txid));
}

/** Sets the block height of recorded steps that have none, from `heights` (txid to height). */
export function withHeights(record: MainnetRecord, heights: Map<string, number>): MainnetRecord {
  return { ...record, escrows: record.escrows.map((e) => ({ ...e, steps: e.steps.map((s) => {
    const h = heights.get(s.txid);
    return s.height === undefined && h !== undefined ? { ...s, height: h } : s;
  }) })) };
}

export function readRecord(file: string): MainnetRecord {
  if (!existsSync(file)) return { network: 'mainnet', escrows: [] };
  return JSON.parse(readFileSync(file, 'utf8')) as MainnetRecord;
}

export function writeRecord(file: string, record: MainnetRecord): void {
  writeAtomic(file, record);
}
