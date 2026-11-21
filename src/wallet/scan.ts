// Finds a connected wallet's coins on every address it uses, not only its first one (docs/decisions/0027). Wallets
// spread coins over many addresses, such as change addresses, so the page walks the `receive` and `change` chains of
// the keys the wallet shared and stops a chain after `gapLimit` addresses in a row that have never had a transaction
// (the BIP44 gap limit; an address that received and spent again still counts as used). Pure: the wallet's keys and
// the chain come in as functions, so the same code runs against Electrum in the page and against fakes in the tests.
// Only libauth is imported.
import { hash160, lockingBytecodeToCashAddress } from '@bitauth/libauth';

export type ScanPath = 'receive' | 'change';
export const SCAN_PATHS: readonly ScanPath[] = ['receive', 'change'];

/** The wallet's public keys: undefined for a chain the wallet did not share. */
export interface ScanKeys {
  pubkey(path: ScanPath, index: number): Uint8Array | undefined;
}

/** An Electrum `listunspent` entry with tokens. */
export interface Unspent {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height?: number;
  token_data?: { category?: string; amount?: string | number; nft?: unknown };
}

/** Read-only chain access, one call per address list so one connection can serve the whole scan. */
export interface ScanChain {
  /** Whether each address has ever had a transaction. */
  used(addresses: string[]): Promise<boolean[]>;
  unspent(addresses: string[]): Promise<Unspent[][]>;
}

export interface ScanLimits {
  /** Unused addresses in a row after which a chain ends. */
  gapLimit: number;
  /** Addresses looked at over all chains, at most. */
  maxAddresses: number;
  /** Addresses asked about in one round. */
  batchSize: number;
}

export interface ScanOptions extends ScanLimits {
  prefix: 'bitcoincash' | 'bchtest' | 'bchreg';
  /** Token category whose fungible units are summed. */
  category: string;
}

export interface WalletAddress {
  path: ScanPath;
  index: number;
  address: string;
  publicKey: Uint8Array;
  sats: number;
  tokenUnits: number;
  utxos: Unspent[];
}

export interface ScanResult {
  /** Used addresses, receive chain first, by index. */
  addresses: WalletAddress[];
  /** Addresses looked at. */
  scanned: number;
  /** Chains the wallet shared. */
  paths: ScanPath[];
  sats: number;
  tokenUnits: number;
}

export function p2pkhLock(publicKey: Uint8Array): Uint8Array {
  return Uint8Array.of(0x76, 0xa9, 0x14, ...hash160(publicKey), 0x88, 0xac);
}

export function p2pkhAddress(publicKey: Uint8Array, prefix: ScanOptions['prefix']): string {
  const r = lockingBytecodeToCashAddress({ bytecode: p2pkhLock(publicKey), prefix });
  if (typeof r === 'string') throw new Error(r);
  return r.address;
}

interface Candidate { path: ScanPath; index: number; address: string; publicKey: Uint8Array }

/** Limits as config gives them, checked: whole numbers, at least one, gap within the ceiling. */
export function scanLimits(raw: ScanLimits): ScanLimits {
  for (const k of ['gapLimit', 'maxAddresses', 'batchSize'] as const) {
    const v = raw[k];
    if (!Number.isInteger(v) || v < 1) throw new Error(`walletTrade.scan.${k} must be a whole number of at least 1`);
  }
  if (raw.gapLimit > raw.maxAddresses) throw new Error('walletTrade.scan.gapLimit is above maxAddresses');
  return { gapLimit: raw.gapLimit, maxAddresses: raw.maxAddresses, batchSize: raw.batchSize };
}

/** The used addresses of one chain, starting from `known` (addresses already seen used need no history query). */
async function walkChain(path: ScanPath, keys: ScanKeys, chain: ScanChain, o: ScanOptions, budget: { left: number },
  known: ReadonlySet<string>): Promise<{ used: Candidate[]; scanned: number }> {
  const used: Candidate[] = [];
  let gap = 0;
  let index = 0;
  let scanned = 0;
  while (gap < o.gapLimit && budget.left > 0) {
    const batch: Candidate[] = [];
    while (batch.length < Math.min(o.batchSize, o.gapLimit - gap, budget.left)) {
      const publicKey = keys.pubkey(path, index);
      if (publicKey === undefined) break;
      batch.push({ path, index, address: p2pkhAddress(publicKey, o.prefix), publicKey });
      index += 1;
    }
    if (batch.length === 0) break;
    budget.left -= batch.length;
    scanned += batch.length;
    const ask = batch.filter((c) => !known.has(c.address));
    const answers = ask.length === 0 ? [] : await chain.used(ask.map((c) => c.address));
    const fresh = new Map(ask.map((c, i) => [c.address, answers[i] === true]));
    for (const c of batch) {
      if (known.has(c.address) || fresh.get(c.address) === true) { used.push(c); gap = 0; } else gap += 1;
    }
  }
  return { used, scanned };
}

function sumTokens(utxos: Unspent[], category: string): number {
  return utxos.filter((u) => u.token_data?.category === category)
    .reduce((a, u) => a + Number(u.token_data?.amount ?? 0), 0);
}

/**
 * Walks the receive and change chains and reads the coins of every used address. `previous` (the last result) lets a
 * poll skip the history of addresses it already knows are used; the gap window after them is asked again.
 */
export async function scanWallet(keys: ScanKeys, chain: ScanChain, o: ScanOptions, previous?: ScanResult):
  Promise<ScanResult> {
  scanLimits(o);
  const known = new Set(previous?.addresses.map((a) => a.address) ?? []);
  const budget = { left: o.maxAddresses };
  const paths = SCAN_PATHS.filter((p) => keys.pubkey(p, 0) !== undefined);
  const found: Candidate[] = [];
  let scanned = 0;
  for (const path of paths) {
    const r = await walkChain(path, keys, chain, o, budget, known);
    found.push(...r.used);
    scanned += r.scanned;
  }
  const coins: Unspent[][] = [];
  for (let i = 0; i < found.length; i += o.batchSize) {
    coins.push(...await chain.unspent(found.slice(i, i + o.batchSize).map((c) => c.address)));
  }
  const addresses = found.map((c, i) => {
    const utxos = coins[i] ?? [];
    return { ...c, utxos, sats: utxos.reduce((a, u) => a + u.value, 0), tokenUnits: sumTokens(utxos, o.category) };
  });
  return { addresses, scanned, paths, sats: addresses.reduce((a, x) => a + x.sats, 0),
    tokenUnits: addresses.reduce((a, x) => a + x.tokenUnits, 0) };
}

/** The address holding the most plain satoshis, if any holds some. */
export function largestAddress(r: ScanResult): WalletAddress | undefined {
  return [...r.addresses].sort((a, b) => b.sats - a.sats)[0];
}
