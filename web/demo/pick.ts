// Which demo escrow the "Release on mainnet" card offers (decision 0021): the escrows recorded in
// examples/mainnet.json plus the pool's list that the host's restage cron serves at pool.indexPath. The card checks
// each on the chain in order and offers the first still waiting at `paid`; when none is, it shows the newest. No SDK
// import here, so tests and the type check load it without the browser bundle.

/** Addresses in the pool's list file, or none when it is missing or not in the expected shape. */
export function parseIndex(body: unknown): string[] {
  const list = (body as { escrows?: unknown } | null)?.escrows;
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is string => typeof a === 'string' && /^bitcoincash:p[0-9a-z]{40,90}$/.test(a));
}

/** Recorded escrows first, then the pool's, each once, at most `max`. */
export function candidates(recorded: string[], pool: string[], max: number): string[] {
  return [...new Set([...recorded, ...pool])].slice(0, max);
}

/** The pool's list file: its escrows, and when present, when the cron last ran, how often, and whether it closed. */
export interface PoolInfo { escrows: string[]; lastRunAt?: number; everyMinutes?: number; closed?: boolean }

export function parsePool(body: unknown): PoolInfo {
  const b = (body ?? {}) as { lastRunAt?: unknown; everyMinutes?: unknown; closed?: unknown };
  const info: PoolInfo = { escrows: parseIndex(body) };
  const at = typeof b.lastRunAt === 'string' ? Date.parse(b.lastRunAt) : NaN;
  if (Number.isFinite(at)) info.lastRunAt = at;
  if (typeof b.everyMinutes === 'number' && Number.isInteger(b.everyMinutes) && b.everyMinutes > 0) {
    info.everyMinutes = b.everyMinutes;
  }
  if (typeof b.closed === 'boolean') info.closed = b.closed;
  return info;
}

export async function fetchPool(path: string, get: typeof fetch = fetch): Promise<PoolInfo> {
  try {
    const res = await get(path, { cache: 'no-store' });
    return res.ok ? parsePool(await res.json()) : { escrows: [] };
  } catch {
    return { escrows: [] };
  }
}

export async function fetchIndex(path: string, get: typeof fetch = fetch): Promise<string[]> {
  return (await fetchPool(path, get)).escrows;
}

/** What the card says when no demo escrow waits: the next one in about `minutes`, the pool closed, or nothing. */
export type PoolNext = { kind: 'soon'; minutes: number } | { kind: 'closed' } | undefined;

/**
 * Minutes until the cron's next run (from its last run and its interval) plus the time a run takes to stage. Nothing
 * when the file does not say, or when the last run is older than `staleRuns` intervals: the cron may be stopped,
 * and a count would be made up.
 */
export function poolNext(info: PoolInfo, now: number, readyMinutes: number, staleRuns = 3): PoolNext {
  if (info.closed === true) return { kind: 'closed' };
  if (info.lastRunAt === undefined || info.everyMinutes === undefined || info.closed === undefined) return undefined;
  const every = info.everyMinutes * 60_000;
  const since = now - info.lastRunAt;
  if (since < 0 || since > staleRuns * every) return undefined;
  return { kind: 'soon', minutes: Math.max(1, Math.ceil((every - since) / 60_000) + readyMinutes) };
}

export interface Picked<S extends string> { address: string; status: S }

/**
 * The first of `addresses` whose status is `paid`, skipping `exclude`; without one, the newest with its status.
 * Undefined when there is no address at all.
 */
export async function pickReady<S extends string>(addresses: string[], status: (a: string) => Promise<S>,
  exclude: ReadonlySet<string> = new Set()): Promise<Picked<S> | undefined> {
  let last: Picked<S> | undefined;
  for (const address of addresses) {
    if (exclude.has(address)) continue;
    const s = await status(address);
    if (s === 'paid') return { address, status: s };
    last = { address, status: s };
  }
  return last;
}
