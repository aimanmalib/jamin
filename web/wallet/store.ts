// The connected wallet, shared by the Wallet tab (which connects it) and the header chip (which shows its balance), so
// the chip stays across tabs. Holds the wallet's public address, a way to read its balance (over every address the
// scan of decision 0027 finds) and the last balance read, which the Wallet tab shows too; never a key.
import { useSyncExternalStore } from 'react';
import type { ScanSummary } from '../../src/wallet/payer.js';

export interface Balance { sats: number; tokenUnits: number; scan?: ScanSummary }

export interface ConnectedWallet {
  name: string;
  address: string;
  readBalance: () => Promise<Balance>;
}

let current: ConnectedWallet | null = null;
let lastBalance: Balance | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function setConnectedWallet(wallet: ConnectedWallet | null): void {
  current = wallet;
  lastBalance = null;
  notify();
}

/** The chip's latest read of the connected wallet's balance. */
export function publishBalance(balance: Balance): void {
  lastBalance = balance;
  notify();
}

function walletBalance(): Balance | null {
  return lastBalance;
}

export function connectedWallet(): ConnectedWallet | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useConnectedWallet(): ConnectedWallet | null {
  return useSyncExternalStore(subscribe, connectedWallet, connectedWallet);
}

export function useWalletBalance(): Balance | null {
  return useSyncExternalStore(subscribe, walletBalance, walletBalance);
}
