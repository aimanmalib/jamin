// Reads coins on mainnet straight from the configured Electrum server, in the browser. Read only: an escrow's coins
// (Lifecycle) and a connected wallet's balance (header chip).
import { ElectrumClient } from '@electrum-cash/network';
import { config } from '../data/config.js';

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

async function listUnspent(address: string): Promise<Unspent[]> {
  const s = config.electrum.mainnet;
  const client = new ElectrumClient('jamin-web', '1.5.3', s.hostname,
    { port: s.port, encrypted: s.scheme === 'wss', timeoutInMilliSeconds: s.timeoutMs });
  await client.connect();
  try {
    const result = await client.request('blockchain.address.listunspent', address, 'include_tokens');
    if (result instanceof Error) throw result;
    return result as Unspent[];
  } finally {
    await client.disconnect(true);
  }
}

export async function fetchCoins(address: string): Promise<Coins> {
  return summarise(await listUnspent(address));
}

export async function fetchBalance(address: string): Promise<{ sats: number; tokenUnits: number }> {
  return balanceOf(await listUnspent(address), config.tokens.pusd.category);
}
