// Reads an escrow's coins on mainnet straight from the configured Electrum server, in the browser. Read only.
import { ElectrumClient } from '@electrum-cash/network';
import { config } from '../data/config.js';

export interface Coins { count: number; sats: number; tokenCoins: number }

interface Unspent { value: number; token_data?: unknown }

/** Count, satoshi total and token-carrying coins of an Electrum `listunspent` result. */
export function summarise(unspent: Unspent[]): Coins {
  return { count: unspent.length, sats: unspent.reduce((a, u) => a + u.value, 0),
    tokenCoins: unspent.filter((u) => u.token_data !== undefined).length };
}

export async function fetchCoins(address: string): Promise<Coins> {
  const s = config.electrum.mainnet;
  const client = new ElectrumClient('jamin-web', '1.5.3', s.hostname,
    { port: s.port, encrypted: s.scheme === 'wss', timeoutInMilliSeconds: s.timeoutMs });
  await client.connect();
  try {
    const result = await client.request('blockchain.address.listunspent', address, 'include_tokens');
    if (result instanceof Error) throw result;
    return summarise(result as Unspent[]);
  } finally {
    await client.disconnect(true);
  }
}
