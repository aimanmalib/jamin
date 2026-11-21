// Reads coins on mainnet straight from the configured Electrum server, in the browser. Read only: an escrow's coins
// (Lifecycle) and a connected wallet's addresses (the scan of decision 0027, which feeds the header chip).
import { ElectrumClient } from '@electrum-cash/network';
import { config } from '../data/config.js';
import type { ScanChain, Unspent as ScanUnspent } from '../../src/wallet/scan.js';

export interface Coins { count: number; sats: number; tokenCoins: number }

interface Unspent { value: number; token_data?: { category?: string; amount?: string | number } }

/** Count, satoshi total and token-carrying coins of an Electrum `listunspent` result. */
export function summarise(unspent: Unspent[]): Coins {
  return { count: unspent.length, sats: unspent.reduce((a, u) => a + u.value, 0),
    tokenCoins: unspent.filter((u) => u.token_data !== undefined).length };
}

/** Satoshis of all coins and token units of `category` (fungible amount, smallest unit) of a `listunspent` result. */
export function balanceOf(unspent: Unspent[], category: string): { sats: number; tokenUnits: number } {
  return { sats: unspent.reduce((a, u) => a + u.value, 0), tokenUnits: unspent
    .filter((u) => u.token_data?.category === category)
    .reduce((a, u) => a + Number(u.token_data?.amount ?? 0), 0) };
}

/** Runs `work` over one connection to the configured server, closed afterwards. */
async function withElectrum<T>(work: (ask: (method: string, ...params: string[]) => Promise<unknown>) => Promise<T>):
  Promise<T> {
  const s = config.electrum.mainnet;
  const client = new ElectrumClient('jamin-web', '1.5.3', s.hostname,
    { port: s.port, encrypted: s.scheme === 'wss', timeoutInMilliSeconds: s.timeoutMs });
  await client.connect();
  try {
    return await work(async (method, ...params) => {
      const result = await client.request(method, ...params);
      if (result instanceof Error) throw result;
      return result;
    });
  } finally {
    await client.disconnect(true);
  }
}

async function listUnspent(address: string): Promise<Unspent[]> {
  return withElectrum(async (ask) => await ask('blockchain.address.listunspent', address, 'include_tokens') as Unspent[]);
}

/** Runs a wallet scan over one connection: history says whether an address was ever used, listunspent its coins. */
export async function withScanChain<T>(work: (chain: ScanChain) => Promise<T>): Promise<T> {
  return withElectrum(async (ask) => work({
    used: async (addresses) => Promise.all(addresses.map(async (a) =>
      (await ask('blockchain.address.get_history', a) as unknown[]).length > 0)),
    unspent: async (addresses) => Promise.all(addresses.map(async (a) =>
      await ask('blockchain.address.listunspent', a, 'include_tokens') as ScanUnspent[])),
  }));
}

export async function fetchCoins(address: string): Promise<Coins> {
  return summarise(await listUnspent(address));
}
