// Where the Wallet tab gets its wallet from: a WizardConnect session over the public relays, or with `?wallet=mock`
// or `?wallet=mock-empty` in the page URL a stand-in wallet in this page (tests only; nothing is signed or sent).
import { openSession } from './session.js';
import { WalletTrade } from './trade.js';
import { mockBackend } from './mock.js';
import { walletMode, type WalletBackend } from './types.js';

export type { WalletBackend, WalletLink } from './types.js';

const live: WalletBackend = {
  open: () => {
    const session = openSession();
    return { uri: session.uri, start: (trade) => WalletTrade.start(session, trade) };
  },
};

export function walletBackend(): WalletBackend {
  const mode = walletMode(location.search, location.hash);
  return mode === 'live' ? live : mockBackend(mode === 'mock-empty');
}
