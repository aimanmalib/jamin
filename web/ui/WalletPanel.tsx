// What the seller's wallet did, when the seller trades from a wallet (decision 0009): the message it signed for the
// escrow's seller key, and that a phone wallet is not connected yet.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import type { Simulation } from '../sim/engine.js';

export function WalletPanel({ sim }: { sim: Simulation }): ReactNode {
  const { t } = useLang();
  const { message } = sim.seller;
  if (message === undefined) return null;
  return (
    <section className="wallet" aria-labelledby="wallet-title" data-testid="wallet-panel">
      <h2 className="h3" id="wallet-title">{t('try.walletTitle')}</h2>
      <p className="small">{t('try.walletNote')}</p>
      <pre className="wallet-message" data-testid="wallet-message">{message}</pre>
      <p className="small muted">{t('try.walletLimit')}</p>
    </section>
  );
}
