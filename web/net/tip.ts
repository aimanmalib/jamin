// The current block height for the Home stats strip: read from the configured Electrum server over one connection
// that stays open while the strip polls, or with `?stats=mock` (tests) a stand-in that grows by one each call.
import { ElectrumClient, type ElectrumClientEvents } from '@electrum-cash/network';
import { config } from '../data/config.js';

export interface TipSource { height(): Promise<number>; close(): void }

/** `?stats=mock` in the page URL (search or hash route) selects the test stand-in. */
export function statsMode(search: string, hash: string): 'live' | 'mock' {
  const at = hash.indexOf('?');
  const value = new URLSearchParams(search).get('stats') ?? new URLSearchParams(at === -1 ? '' : hash.slice(at + 1)).get('stats');
  return value === 'mock' ? 'mock' : 'live';
}

export function mockTip(start: number = config.stats.mockStartHeight): TipSource {
  let next = start;
  return { height: () => Promise.resolve(next++), close: () => undefined };
}

/** Height from a `blockchain.headers.get_tip` result, or an error when it has none. */
export function tipHeight(result: unknown): number {
  const h = (result as { height?: unknown } | null)?.height;
  if (typeof h !== 'number' || !Number.isInteger(h) || h <= 0) throw new Error('no block height in the reply');
  return h;
}

export function electrumTip(): TipSource {
  const s = config.electrum.mainnet;
  let client: ElectrumClient<ElectrumClientEvents> | undefined;
  const drop = (): void => { const c = client; client = undefined; void c?.disconnect(true).catch(() => undefined); };
  return {
    async height() {
      try {
        if (!client) {
          client = new ElectrumClient('jamin-web', '1.5.3', s.hostname,
            { port: s.port, encrypted: s.scheme === 'wss', timeoutInMilliSeconds: s.timeoutMs });
          await client.connect();
        }
        const result = await client.request('blockchain.headers.get_tip');
        if (result instanceof Error) throw result;
        return tipHeight(result);
      } catch (e) {
        drop();
        throw e;
      }
    },
    close: drop,
  };
}
