// The connected wallet's balance in the Wallet tab (decision 0027): the total over every receive and change address
// the scan found, how far it looked, and, when the wallet holds nothing, a plain empty state that offers the
// simulator instead. When the coins are spread so that no single address can pay, it says so and suggests gathering
// them inside the visitor's own wallet app. It never asks for coins to be sent to this page.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config } from '../data/config.js';
import { useWalletBalance } from '../wallet/store.js';
import { formatBalance } from '../wallet/format.js';
import { shortOfCoins } from '../wallet/failure.js';

export function WalletBalance({ name }: { name: string }): ReactNode {
  const { t } = useLang();
  const b = useWalletBalance();
  if (!b) return <p className="small muted" role="status" data-testid="wallet-scanning">{t('wallet.scanning')}</p>;
  const scan = b.scan;
  if (b.sats === 0) {
    return (
      <div className="wallet-empty" data-testid="wallet-empty">
        <h2 className="h3">{t('wallet.noCoins')}</h2>
        <p className="small">{t('wallet.noCoinsDetail', { scanned: scan?.scanned ?? 0, name: name || '?' })}</p>
        <a className="btn btn-primary" href="#/try" data-testid="wallet-try-demo">{t('wallet.tryDemo')}</a>
      </div>
    );
  }
  const min = config.walletTrade.minGenesisCoinSats;
  const short = scan !== undefined && !scan.canCreate;
  return (
    <>
      <p className="small" data-testid="wallet-balance">{t('wallet.balanceLine', { bch: formatBalance(b).bch,
        used: scan?.used ?? 0, scanned: scan?.scanned ?? 0 })}</p>
      {short && <p className="notice small" data-testid="wallet-short">{scan.largestSats >= min
        ? t('wallet.createNeeds', { sats: min }) : shortOfCoins(t, min, b.sats, scan.largestSats)}</p>}
    </>
  );
}

/** Whether the last scan found a coin an escrow can be created from. */
export function useCanCreate(): boolean {
  return useWalletBalance()?.scan?.canCreate === true;
}
