// The numbers of the Home stats strip (decision 0023). The recorded ones are counted from examples/mainnet.json by
// pure functions, so a test can tie each number to that file; only the block height comes from the network.
import { isRefused, mainnet, type MainnetRun } from './examples.js';

export interface RecordedStats {
  /** Escrows recorded on mainnet. */
  escrows: number;
  /** Satoshis the BCH escrows' fund transactions locked (amount, fee and container reserve). */
  lockedSats: number;
  /** Token units (smallest unit) the token escrows' deposit transactions locked; never added to the satoshis. */
  lockedUnits: number;
  /** Calls the network refused, each with its server's text. */
  refused: number;
}

export function recordedStats(run: MainnetRun = mainnet): RecordedStats {
  const steps = run.escrows.flatMap((e) => e.steps);
  const ok = steps.filter((s) => !isRefused(s)) as { lockedSats?: number; lockedUnits?: number }[];
  return {
    escrows: run.escrows.length,
    lockedSats: ok.reduce((a, s) => a + (s.lockedSats ?? 0), 0),
    lockedUnits: ok.reduce((a, s) => a + (s.lockedUnits ?? 0), 0),
    refused: steps.filter(isRefused).length,
  };
}

/** Demo pool escrows the host's list names that examples/mainnet.json does not record yet. */
export function unrecordedPool(pool: string[], run: MainnetRun = mainnet): number {
  const recorded = new Set(run.escrows.map((e) => e.address));
  return new Set(pool.filter((a) => !recorded.has(a))).size;
}

/** Satoshis as BCH with eight decimals, grouped for `locale`. */
export function bchText(sats: number, locale: string): string {
  return (sats / 1e8).toLocaleString(locale, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
}

/** Token units as whole tokens with `decimals` places, grouped for `locale`. */
export function tokenText(units: number, decimals: number, locale: string): string {
  return (units / 10 ** decimals).toLocaleString(locale, { minimumFractionDigits: decimals,
    maximumFractionDigits: decimals });
}

/** Whole seconds from `since` to `now` (milliseconds), never negative. */
export function secondsAgo(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 1000));
}

/** How often the strip asks for the block height: stats.pollMs (mockPollMs in mock mode) held to the allowed range. */
export function statsPollMs(mode: 'live' | 'mock', s: { pollMs: number; mockPollMs: number;
  pollRangeMs: { min: number; max: number } }): number {
  if (mode === 'mock') return s.mockPollMs;
  return Number.isFinite(s.pollMs) ? Math.min(s.pollRangeMs.max, Math.max(s.pollRangeMs.min, s.pollMs)) : s.pollRangeMs.max;
}
