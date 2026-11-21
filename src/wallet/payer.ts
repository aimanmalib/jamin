// Which of the wallet's addresses pays for a step (docs/decisions/0027). An escrow step is paid from ONE address of the
// wallet: the SDK's external signer spends that address's coins and returns the change to it. The page picks the
// address that holds enough; when the wallet holds enough only spread over several addresses, it says so and asks the
// visitor to gather the coins inside their own wallet app. The page never asks for coins to be sent to it.
import type { ScanResult, WalletAddress } from './scan.js';
import type { WizKey } from './wizard.js';

/** No single address of the wallet can pay `need`: `total` over all addresses, `largest` at one address. */
export class NoPayer extends Error {
  constructor(readonly need: number, readonly total: number, readonly largest: number) {
    super(`no single wallet address holds ${need} sat (wallet total ${total} sat, largest address ${largest} sat)`);
  }
}

function plainSats(a: WalletAddress): number {
  return a.utxos.filter((u) => u.token_data === undefined).reduce((s, u) => s + u.value, 0);
}

function largestPlain(r: ScanResult): number {
  return Math.max(0, ...r.addresses.map(plainSats));
}

/** The address with a plain coin at output 0 of at least `min` (a contract's token genesis spends one), the richest. */
export function genesisPayer(r: ScanResult, min: number): WalletAddress | undefined {
  const best = (a: WalletAddress): number => Math.max(0, ...a.utxos
    .filter((u) => u.tx_pos === 0 && u.token_data === undefined && u.value >= min).map((u) => u.value));
  return r.addresses.filter((a) => best(a) > 0).sort((a, b) => best(b) - best(a))[0];
}

/** The address with at least `need` plain satoshis, the richest. */
export function payerFor(r: ScanResult, need: number): WalletAddress | undefined {
  return r.addresses.filter((a) => plainSats(a) >= need).sort((a, b) => plainSats(b) - plainSats(a))[0];
}

export function requireGenesisPayer(r: ScanResult, min: number): WalletAddress {
  const a = genesisPayer(r, min);
  if (a === undefined) throw new NoPayer(min, r.sats, largestPlain(r));
  return a;
}

export function requirePayer(r: ScanResult, need: number): WalletAddress {
  const a = payerFor(r, need);
  if (a === undefined) throw new NoPayer(need, r.sats, largestPlain(r));
  return a;
}

export function keyOf(a: WalletAddress): WizKey {
  return { path: a.path, index: a.index, publicKey: a.publicKey };
}

/** What the Wallet tab shows about a scan: how far it looked and whether an escrow can be created from one address. */
export interface ScanSummary { scanned: number; used: number; largestSats: number; canCreate: boolean }

export function summary(r: ScanResult, minGenesis: number): ScanSummary {
  return { scanned: r.scanned, used: r.addresses.length, largestSats: largestPlain(r),
    canCreate: genesisPayer(r, minGenesis) !== undefined };
}
