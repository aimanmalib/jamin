// The connected wallet, shared by the Wallet tab (which connects it) and the header chip (which shows its balance), so
// the chip stays across tabs. Holds the wallet's public address and a way to read its balance; never a key.
import { useSyncExternalStore } from 'react';

export interface Balance { sats: number; tokenUnits: number }

export interface ConnectedWallet {
  name: string;
  address: string;
  readBalance: () => Promise<Balance>;
}

let current: ConnectedWallet | null = null;
const listeners = new Set<() => void>();

export function setConnectedWallet(wallet: ConnectedWallet | null): void {
  current = wallet;
  for (const l of listeners) l();
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
