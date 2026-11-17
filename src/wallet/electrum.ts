import { ElectrumClient } from '@electrum-cash/network';
import type { ElectrumServer } from '../config.js';

export interface Balance {
  confirmed: number;
  unconfirmed: number;
}

/** Reads the balance of one address from the configured Electrum server. Read only. */
export async function fetchBalance(server: ElectrumServer, address: string): Promise<Balance> {
  const client = new ElectrumClient('jamin', '1.5.3', server.hostname, {
    port: server.port,
    encrypted: server.scheme === 'wss',
    timeoutInMilliSeconds: server.timeoutMs,
  });
  await client.connect();
  try {
    const result = await client.request('blockchain.address.get_balance', address);
    if (result instanceof Error) throw result;
    const { confirmed, unconfirmed } = result as { confirmed: number; unconfirmed: number };
    return { confirmed, unconfirmed };
  } finally {
    await client.disconnect(true);
  }
}
