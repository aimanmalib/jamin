// Why the demo pool is closed, from the pool's list file (src/demo/pool.ts `closedReason`, decision 0021). Only
// `funds` changes the card: the pool waits for the project's demo wallet to be restocked, and the host cron stages
// again by itself once it is. Every other reason, and an older file without one, keeps the "pool is closed" line.
// The card explains; it never asks a visitor to send anything and shows no address for it.
import { CLOSED_REASONS, type ClosedReason } from '../../src/demo/closed-reason.js';

export function parseClosedReason(body: unknown): ClosedReason | undefined {
  const b = (body ?? {}) as { closed?: unknown; closedReason?: unknown };
  if (b.closed !== true) return undefined;
  return CLOSED_REASONS.find((r) => r === b.closedReason);
}

export async function fetchClosedReason(path: string, get: typeof fetch = fetch): Promise<ClosedReason | undefined> {
  try {
    const res = await get(path, { cache: 'no-store' });
    return res.ok ? parseClosedReason(await res.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** The text key for the card's line when the pool is closed. */
export function poolLineKey(reason: ClosedReason | undefined): 'demo.poolRestock' | 'demo.poolClosed' {
  return reason === 'funds' ? 'demo.poolRestock' : 'demo.poolClosed';
}
