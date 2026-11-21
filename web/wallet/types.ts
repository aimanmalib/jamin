// Shapes shared by the live wallet trade, the test stand-in and the Wallet tab; free of SDK imports, so unit tests
// and the root typecheck load them without the web build's bundler types.
import type { Balance } from './store.js';

export type TradeStep = 'createEscrow' | 'fund' | 'release';

export interface TradeTx { step: TradeStep; txid: string }

/** What the Wallet tab needs from a trade: the live one, or the stand-in of `?wallet=mock` (tests). */
export interface TradeApi {
  readonly trade: string;
  readonly walletName: string;
  /** The wallet's own address that pays the next step (decision 0027): shown as an address in the visitor's wallet. */
  readonly sellerAddress: string;
  readonly roleKey: Uint8Array;
  readonly txs: TradeTx[];
  hasEscrow(): boolean;
  create(buyer: Uint8Array): Promise<string>;
  resume(escrow: string, buyer: Uint8Array): Promise<void>;
  fund(): Promise<string>;
  status(): Promise<bigint>;
  release(): Promise<string>;
  address(): Promise<string>;
  /** Scans the wallet's receive and change addresses and returns the total (decision 0027). */
  balance(): Promise<Balance>;
}

export interface WalletLink {
  /** The `wiz://` link for the wallet to scan or paste. */
  uri: string;
  /** Waits for the wallet, then has it sign the role key request for `trade`. */
  start(trade: string): Promise<TradeApi>;
}

export interface WalletBackend {
  open(): WalletLink;
}

export type WalletMode = 'live' | 'mock' | 'mock-empty';

/** `?wallet=mock` (coins over several addresses) or `?wallet=mock-empty` (none) selects the test stand-in. */
export function walletMode(search: string, hash: string): WalletMode {
  const at = hash.indexOf('?');
  const fromHash = new URLSearchParams(at === -1 ? '' : hash.slice(at + 1));
  const value = new URLSearchParams(search).get('wallet') ?? fromHash.get('wallet');
  return value === 'mock' || value === 'mock-empty' ? value : 'live';
}
