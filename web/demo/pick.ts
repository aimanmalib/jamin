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

export async function fetchIndex(path: string, get: typeof fetch = fetch): Promise<string[]> {
  try {
    const res = await get(path, { cache: 'no-store' });
    return res.ok ? parseIndex(await res.json()) : [];
  } catch {
    return [];
  }
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
