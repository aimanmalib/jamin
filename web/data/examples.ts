// Recorded runs on real networks: examples/regtest.json (stock BCHN regtest) and examples/mainnet.json (filled by the
// mainnet run; empty until then).
import regtestRaw from '../../examples/regtest.json' with { type: 'json' };
import mainnetRaw from '../../examples/mainnet.json' with { type: 'json' };

export interface RegtestTx {
  branch: string; step: string; txid: string; height: number; txBytes: number; inputs: number;
  largestUnlockBytes: number;
}
export interface RegtestRun { node: string; measuredAt: string; unlockLimitBytes: number; transactions: RegtestTx[] }

export interface MainnetStep { step: string; txid: string; height?: number }
export interface MainnetEscrow { branch: string; asset: string; address?: string; steps: MainnetStep[] }
export interface MainnetRun { escrows: MainnetEscrow[] }

export const regtest = regtestRaw as RegtestRun;
export const mainnet = mainnetRaw as MainnetRun;

/** Transactions grouped by branch letter, in recorded order. */
export function byBranch<T extends { branch: string }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.branch, [...(groups.get(r.branch) ?? []), r]);
  return [...groups.entries()];
}
