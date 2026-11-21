// What the Wallet tab shows once the wallet ended the session, or did not come back from a dropped connection within
// `walletTrade.reconnectGraceMs` (decision 0028): the escrow is on chain and untouched, and "Connect again" opens a new
// session for the same trade name, so the same wallet gives the same seller key and the escrow continues.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { WizardHat } from './WizardHat.js';

export function WalletEnded({ onConnect, disabled }: { onConnect: () => void; disabled: boolean }): ReactNode {
  const { t } = useLang();
  return (
    <div className="wallet wallet-ended" role="status" data-testid="wallet-ended">
      <p className="wallet-ended-title">{t('wallet.ended')}</p>
      <p className="small">{t('wallet.endedDetail')}</p>
      <button type="button" className="btn btn-primary" onClick={onConnect} disabled={disabled}
        data-testid="wallet-connect-again"><WizardHat />{t('wallet.connectAgain')}</button>
    </div>
  );
}
