// The header's wallet button on every page: "Connect wallet" with the WizardConnect hat before a wallet is connected,
// then the wallet's BCH balance over all its addresses (and PUSD when it holds some), read from the network and kept
// current by itself; the Wallet tab shows the same read.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { publishBalance, useConnectedWallet, useWalletBalance } from '../wallet/store.js';
import { formatBalance } from '../wallet/format.js';
import { usePolling } from '../wallet/poll.js';
import { WizardHat } from './WizardHat.js';

export function WalletChip(): ReactNode {
  const { t } = useLang();
  const wallet = useConnectedWallet();
  const balance = useWalletBalance();
  usePolling(async () => { if (wallet) publishBalance(await wallet.readBalance()); }, wallet !== null);
  if (!wallet) {
    return (
      <a className="btn-wallet" href="#/wallet" data-testid="header-wallet">
        <WizardHat /><span className="chip-label">{t('wallet.connectShort')}</span>
      </a>
    );
  }
  const shown = balance ? formatBalance(balance) : null;
  return (
    <a className="btn-wallet connected" href="#/wallet" data-testid="header-wallet"
      title={t('wallet.chipLabel', { name: wallet.name })}>
      <WizardHat />
      <span data-testid="header-balance">{shown ? shown.bch : t('wallet.chipReading')}</span>
      {shown && shown.token !== '' && <span className="chip-token" data-testid="header-token">{shown.token}</span>}
    </a>
  );
}
