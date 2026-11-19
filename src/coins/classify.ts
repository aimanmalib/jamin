// The coins an escrow leaves at its contract addresses once it has finished, and what they add up to. Pure: the
// network reads are in scripts/contract-coins.ts, which hands the coins and the addresses they sit at to this file.

/**
 * What a coin at a contract address is, named after the stateful contract's address it sits at. 'identity' is the
 * category's metadata authhead each deployment creates at output 0, owned by the deployer's lock. 'filler' is an
 * output the SDK leaves at an unused index, at a lock every contract shares (src/coins/filler.ts).
 */
export type CoinKind = 'master' | 'data' | 'satoshiContainer' | 'tokenContainer' | 'event' | 'filler' | 'identity'
  | 'other';

export const COIN_KINDS: readonly CoinKind[] = ['master', 'data', 'satoshiContainer', 'tokenContainer', 'event', 'filler',
  'identity', 'other'];

/** Kinds anyone may spend once a relative lock has passed. */
export const SWEPT_KINDS: readonly CoinKind[] = ['event', 'filler'];

/** One address of a contract, by locking bytecode (hex), with the kind of coin that belongs there. */
export interface ContractAddress {
  lock: string;
  address: string;
  kind: Exclude<CoinKind, 'other'>;
  /** The event an event address records. */
  event?: string;
  /** Other people's coins sit at this lock too: only the escrow's own transactions' outputs are counted. */
  shared?: boolean;
}

export interface ContractCoin {
  branch: string;
  kind: CoinKind;
  event?: string;
  txid: string;
  vout: number;
  satoshis: number;
  /** Fungible token units the coin carries. */
  tokenAmount?: number;
  /** The block the coin was created in, when known. */
  height?: number;
}

export interface ListedCoin {
  txid: string;
  vout: number;
  satoshis: number;
  tokenAmount?: number;
  height?: number;
}

/**
 * Classifies the coins listed at each lock of one escrow. A lock no address of the contract names makes 'other'; a
 * lock listed twice (a P2SH address and its token-aware form) is counted once.
 */
export function classify(branch: string, addresses: readonly ContractAddress[],
  listed: ReadonlyMap<string, readonly ListedCoin[]>): ContractCoin[] {
  const byLock = new Map(addresses.map((a) => [a.lock, a]));
  const seen = new Set<string>();
  const coins: ContractCoin[] = [];
  for (const [lock, list] of listed) {
    const a = byLock.get(lock);
    for (const c of list) {
      const id = `${c.txid}:${c.vout}`;
      if (seen.has(id)) continue;
      seen.add(id);
      coins.push({ branch, kind: a?.kind ?? 'other', ...(a?.event === undefined ? {} : { event: a.event }), ...c });
    }
  }
  return coins.sort((x, y) => COIN_KINDS.indexOf(x.kind) - COIN_KINDS.indexOf(y.kind) || x.txid.localeCompare(y.txid)
    || x.vout - y.vout);
}

export interface KindTotal {
  kind: CoinKind;
  coins: number;
  satoshis: number;
  tokenAmount: number;
}

/** Coins and satoshis per kind, in COIN_KINDS order; kinds with no coin are left out. */
export function totalsByKind(coins: readonly ContractCoin[]): KindTotal[] {
  return COIN_KINDS.map((kind) => {
    const of = coins.filter((c) => c.kind === kind);
    return { kind, coins: of.length, satoshis: sum(of.map((c) => c.satoshis)),
      tokenAmount: sum(of.map((c) => c.tokenAmount ?? 0)) };
  }).filter((t) => t.coins > 0);
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, v) => a + v, 0);
}

/**
 * The first block an event or filler coin can be spent in: its covenant checks a relative lock of `relativeBlocks`
 * (OP_CHECKSEQUENCEVERIFY), so a coin mined at height h can be spent in a block at h + relativeBlocks.
 */
export function spendableFrom(height: number, relativeBlocks: number): number {
  return height + relativeBlocks;
}

/** Event and filler coins the next block can include, given the chain tip. */
export function matured(coins: readonly ContractCoin[], tip: number, relativeBlocks: number): ContractCoin[] {
  return coins.filter((c) => SWEPT_KINDS.includes(c.kind) && c.height !== undefined
    && spendableFrom(c.height, relativeBlocks) <= tip + 1);
}
