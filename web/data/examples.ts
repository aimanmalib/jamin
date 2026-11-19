// Recorded runs on real networks: examples/regtest.json (stock BCHN regtest) and examples/mainnet.json (filled by the
// mainnet run).
import regtestRaw from '../../examples/regtest.json' with { type: 'json' };
import mainnetRaw from '../../examples/mainnet.json' with { type: 'json' };

export interface RegtestTx {
  branch: string; step: string; txid: string; height: number; txBytes: number; inputs: number;
  largestUnlockBytes: number;
}
export interface MainnetStep { step: string; txid: string; height?: number; signer?: 'wallet'; wallet?: string }
/** A call the network refused (docs/decisions/0015): never mined, so a raw hash and no txid. */
export interface RefusedStep {
  step: string; refused: true; by: string; expected: string; rawTxHash: string; serverError: string; at: string;
}
export type EscrowStep = MainnetStep | RefusedStep;
/** `demo`: the public demo escrow a visitor may release (docs/decisions/0020-public-demo-escrow.md). */
export interface MainnetEscrow { branch: string; asset: string; address?: string; demo?: boolean; steps: EscrowStep[] }
export interface RefusedRun extends MainnetEscrow { node: string; measuredAt: string }

export interface RegtestRun {
  node: string; measuredAt: string; unlockLimitBytes: number; transactions: RegtestTx[]; refused?: RefusedRun;
}

export function isRefused(s: EscrowStep): s is RefusedStep {
  return 'refused' in s && s.refused;
}
export interface MainnetRun { escrows: MainnetEscrow[] }

export const regtest = regtestRaw as RegtestRun;
export const mainnet = mainnetRaw as MainnetRun;

/** Transactions grouped by branch letter, in recorded order. */
export function byBranch<T extends { branch: string }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.branch, [...(groups.get(r.branch) ?? []), r]);
  return [...groups.entries()];
}

/** The address of the public demo escrow on mainnet, once one is recorded. */
export function demoEscrowAddress(run: MainnetRun = mainnet): string | undefined {
  return run.escrows.find((e) => e.demo === true)?.address;
}
