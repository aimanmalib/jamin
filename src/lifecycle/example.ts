// The recorded regtest run the web app shows (examples/regtest.json), made from a lifecycle run file, and the branch R
// escrow (calls the node refused, decision 0015) from a run of that branch.
import type { RefusedStep } from './context.js';
import { addSteps, type MainnetEscrow } from './record.js';

export interface RegtestRunFile {
  network: string;
  node: string;
  at: string;
  failures: string[];
  steps: Array<{ branch: string; step: string; txid: string; txBytes: number; inputs: number;
    maxUnlockingBytes: number; feeSats?: number; height: number | null; escrow?: string }>;
  refused?: RefusedStep[];
}

/** Branch R on regtest: the escrow's steps with the refused attempts in place, as examples/mainnet.json keeps them. */
export interface RefusedExample extends MainnetEscrow { node: string; measuredAt: string }

export interface RegtestExample {
  network: 'regtest';
  node: string;
  measuredAt: string;
  source: string;
  unlockLimitBytes: number;
  transactions: Array<{ branch: string; step: string; txid: string; height: number; txBytes: number; inputs: number;
    largestUnlockBytes: number; feeSats?: number }>;
  refused?: RefusedExample;
}

/** Per-input unlocking bytecode limit of the May 2025 VM limits upgrade. */
const UNLOCK_LIMIT_BYTES = 10_000;

/** `/Bitcoin Cash Node:29.0.0(EB32.0)/` becomes `Bitcoin Cash Node 29.0.0`. */
export function nodeName(subversion: string): string {
  const m = /^\/?([^:/]+):([^(/]+)/.exec(subversion);
  return m ? `${m[1]} ${m[2]}` : subversion;
}

export function regtestExample(run: RegtestRunFile): RegtestExample {
  if (run.network !== 'regtest') throw new Error(`not a regtest run: ${run.network}`);
  if (run.failures.length > 0) throw new Error(`the run has failed branches: ${run.failures.join('; ')}`);
  return {
    network: 'regtest',
    node: nodeName(run.node),
    measuredAt: `${run.at.slice(0, 16)}:00Z`,
    source: 'docs/MEASURED.md#regtest-real-consensus-limits',
    unlockLimitBytes: UNLOCK_LIMIT_BYTES,
    transactions: run.steps.map((s) => {
      if (s.height === null) throw new Error(`${s.branch} ${s.step} ${s.txid} was not mined`);
      return { branch: s.branch, step: s.step, txid: s.txid, height: s.height, txBytes: s.txBytes, inputs: s.inputs,
        largestUnlockBytes: s.maxUnlockingBytes, ...(s.feeSats === undefined ? {} : { feeSats: s.feeSats }) };
    }),
  };
}

export function refusedExample(run: RegtestRunFile): RefusedExample {
  if (run.network !== 'regtest') throw new Error(`not a regtest run: ${run.network}`);
  if (run.failures.length > 0) throw new Error(`the run has failed branches: ${run.failures.join('; ')}`);
  const refused = (run.refused ?? []).filter((r) => r.branch === 'R');
  if (refused.length === 0) throw new Error('the run has no refused attempts (run --branches R)');
  const steps = run.steps.filter((s) => s.branch === 'R').map((s) => {
    if (s.height === null) throw new Error(`R ${s.step} ${s.txid} was not mined`);
    return { branch: s.branch, step: s.step, txid: s.txid, height: s.height, ...(s.escrow ? { escrow: s.escrow } : {}) };
  });
  const [escrow] = addSteps({ network: 'mainnet', escrows: [] }, steps, refused).escrows;
  if (!escrow) throw new Error('the run has no branch R escrow');
  return { node: nodeName(run.node), measuredAt: `${run.at.slice(0, 16)}:00Z`, ...escrow };
}
