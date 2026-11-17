// One mainnet lifecycle run over a wallet context. Time cannot be moved on mainnet, so branch D is split: a run opens
// the D escrow and records it as pending; a run after the waiting time finishes it. A run without a token coin skips
// branch B. Every transaction still goes through the context's gated provider.
import { branchA, branchB, branchC, branchE, finishD, pendingD, resumeD, startD } from './branches.js';
import type { Ctx, Step } from './context.js';
import { NoTokenError, WaitError } from './mainnet.js';
import { clearPending, loadPending, savePending } from './record.js';

export interface RunResult {
  /** Contract transactions of this run, including the D steps a previous run recorded when D finished now. */
  steps: Step[];
  failures: string[];
  skipped: string[];
  /** Set when a D escrow waits for its seller-cancel time (median time past, seconds). */
  waitingUntil?: bigint;
}

const BODIES: Record<string, (c: Ctx) => Promise<void>> = { A: branchA, B: branchB, C: branchC, E: branchE };

/** Runs the wanted branches; `steps` is the context's own step list, which the branches append to. */
export async function runBranches(ctx: Ctx, steps: Step[], wanted: string[], pendingFile: string): Promise<RunResult> {
  const result: RunResult = { steps, failures: [], skipped: [] };
  const fail = (name: string, e: unknown): void => { result.failures.push(`${name}: ${(e as Error).message}`); };
  let resumed = false;

  const pending = loadPending(pendingFile);
  if (pending && wanted.includes('D')) {
    resumed = true;
    try {
      await finishD(ctx, await resumeD(ctx, pending.d));
      clearPending(pendingFile);
    } catch (e) {
      if (e instanceof WaitError) result.waitingUntil = e.until;
      else fail('D', e);
    }
  }

  for (const name of wanted) {
    if (name === 'D') {
      if (resumed) continue;
      const before = steps.length;
      try {
        const d = await startD(ctx);
        try {
          await finishD(ctx, d);
        } catch (e) {
          if (!(e instanceof WaitError)) throw e;
          savePending(pendingFile, await pendingD(d), steps.slice(before));
          result.waitingUntil = e.until;
        }
      } catch (e) {
        fail('D', e);
      }
      continue;
    }
    const body = BODIES[name];
    if (!body) { fail(name, new Error('unknown branch')); continue; }
    try {
      await body(ctx);
    } catch (e) {
      if (e instanceof NoTokenError) result.skipped.push(`${name}: ${e.message}`);
      else fail(name, e);
    }
  }
  return result;
}
