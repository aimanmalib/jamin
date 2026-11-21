// The dapp end of a WizardConnect session in the page (docs/decisions/0014): it opens a relay channel, offers the
// connection link for the wallet to paste or scan, and once the wallet is ready exposes its `receive/0` key, the keys
// of every receive and change address for the balance scan (decision 0027) and a transport for sign requests. Relays
// and names come from config/jamin.json. After the wallet is ready the session keeps watching it (decision 0028): a
// wallet that ends the session, or a reconnect longer than `walletTrade.reconnectGraceMs`, ends it here too.
import { DappConnectionManager } from '@wizardconnect/dapp';
import { childIndexOfPathName, initiateDappRelay, type DappRelayResult } from '@wizardconnect/core';
import type { WizSignRequest, WizTransport } from '../../src/wallet/wizard.js';
import type { ScanKeys } from '../../src/wallet/scan.js';
import { config } from '../data/config.js';
import { watchLink, type Link } from './link.js';

export interface WizSession {
  /** The `wiz://` link the wallet pastes; shown only until the wallet connects. */
  uri: string;
  ready: Promise<WizReady>;
  transport: WizTransport;
  close(): Promise<void>;
}

export interface WizReady { walletName: string; publicKey: Uint8Array; keys: ScanKeys; link: Link }

/** The keys of a connected dapp by path name; a path the wallet did not share gives none. */
export function sessionKeys(dapp: Pick<DappConnectionManager, 'getPubkey' | 'hasPath'>): ScanKeys {
  return { pubkey: (path, index) => {
    const child = childIndexOfPathName(path);
    return child === undefined || !dapp.hasPath(child) ? undefined : dapp.getPubkey(child, BigInt(index));
  } };
}

export function openSession(): WizSession {
  const w = config.walletTrade;
  const dapp = new DappConnectionManager(w.dappName, `${config.site.url}/favicon.svg`, { session: false });
  const relay: DappRelayResult = initiateDappRelay((p) => { dapp.updateConnection(p.client, p.status); },
    { explicitRelayUrls: w.relayUrls });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await dapp.sendDisconnect().catch(() => undefined);
    await dapp.destroy();
    relay.cleanup();
  };
  let link: Link | undefined;
  const ready = new Promise<WizReady>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('timeout')); void close(); }, w.connectTimeoutMs);
    dapp.on('walletready', () => {
      if (link !== undefined) return;
      clearTimeout(timer);
      const keys = sessionKeys(dapp);
      const publicKey = keys.pubkey('receive', 0);
      if (publicKey === undefined) { reject(new Error('the wallet shared no receive key')); return; }
      link = watchLink(dapp, w.reconnectGraceMs, () => { void close(); });
      resolve({ walletName: dapp.walletName ?? '', publicKey, keys, link });
    });
    dapp.on('disconnect', (_reason, message) => { clearTimeout(timer); reject(new Error(message ?? 'disconnected')); });
  });
  const sign = async (request: WizSignRequest): Promise<{ signedTransaction: string }> => {
    const answer = await dapp.signTransaction(request as unknown as Parameters<typeof dapp.signTransaction>[0]);
    if (answer.error !== undefined) throw new Error(answer.error);
    return { signedTransaction: answer.signedTransaction };
  };
  const transport: WizTransport = {
    signTransaction: async (request: WizSignRequest) => (link ? link.guard(sign(request)) : sign(request)),
  };
  return { uri: relay.uri, ready, transport, close: async () => { if (link) link.end(); else await close(); } };
}
