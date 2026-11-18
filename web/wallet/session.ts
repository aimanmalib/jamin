// The dapp end of a WizardConnect session in the page (docs/decisions/0014): it opens a relay channel, offers the
// connection link for the wallet to paste or scan, and once the wallet is ready exposes its `receive/0` key and a
// transport for sign requests. Relays and names come from config/jamin.json.
import { DappConnectionManager } from '@wizardconnect/dapp';
import { initiateDappRelay, type DappRelayResult } from '@wizardconnect/core';
import type { WizSignRequest, WizTransport } from '../../src/wallet/wizard.js';
import { config } from '../data/config.js';

export interface WizSession {
  /** The `wiz://` link the wallet pastes; shown only until the wallet connects. */
  uri: string;
  ready: Promise<{ walletName: string; publicKey: Uint8Array }>;
  transport: WizTransport;
  close(): Promise<void>;
}

export function openSession(): WizSession {
  const w = config.walletTrade;
  const dapp = new DappConnectionManager(w.dappName, `${config.site.url}/favicon.svg`, { session: false });
  const relay: DappRelayResult = initiateDappRelay((p) => { dapp.updateConnection(p.client, p.status); },
    { explicitRelayUrls: w.relayUrls });
  const ready = new Promise<{ walletName: string; publicKey: Uint8Array }>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('timeout')); }, w.connectTimeoutMs);
    dapp.on('walletready', () => {
      clearTimeout(timer);
      const publicKey = dapp.getPubkey(0, 0n);
      if (publicKey === undefined) { reject(new Error('the wallet shared no receive key')); return; }
      resolve({ walletName: dapp.walletName ?? '', publicKey });
    });
    dapp.on('disconnect', (_reason, message) => { clearTimeout(timer); reject(new Error(message ?? 'disconnected')); });
  });
  const transport: WizTransport = {
    signTransaction: async (request: WizSignRequest) => {
      const answer = await dapp.signTransaction(request as unknown as Parameters<typeof dapp.signTransaction>[0]);
      if (answer.error !== undefined) throw new Error(answer.error);
      return { signedTransaction: answer.signedTransaction };
    },
  };
  return { uri: relay.uri, ready, transport,
    close: async () => { await dapp.sendDisconnect().catch(() => undefined); await dapp.destroy(); relay.cleanup(); } };
}
