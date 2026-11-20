// The WizardConnect link for the wallet: a QR code to scan (tap it to copy the link), the full link as text and a
// copy button, with a short "Copied" note read out to screen readers.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config } from '../data/config.js';
import { qrShape } from '../wallet/qr.js';
import { copyText } from '../wallet/copy.js';
import { WizardHat } from './WizardHat.js';

export function WalletQr({ uri, waiting }: { uri: string; waiting: boolean }): ReactNode {
  const { t } = useLang();
  const shape = useMemo(() => qrShape(uri), [uri]);
  const [note, setNote] = useState<'' | 'copied' | 'copyFailed'>('');
  useEffect(() => {
    if (note === '') return undefined;
    const timer = setTimeout(() => { setNote(''); }, config.walletTrade.copiedMs);
    return () => { clearTimeout(timer); };
  }, [note]);
  const copy = (): void => { void copyText(uri).then((ok) => { setNote(ok ? 'copied' : 'copyFailed'); }); };
  return (
    <div className="wallet wallet-qr" data-testid="wallet-link-box">
      <p className="wiz-label"><WizardHat />{t('wallet.wizardConnect')}</p>
      <p className="small">{t('wallet.linkNote')}</p>
      <button type="button" className="qr" onClick={copy} aria-label={t('wallet.qrLabel')} data-testid="wallet-qr">
        <svg viewBox={`0 0 ${shape.size} ${shape.size}`} role="img" aria-hidden="true" shapeRendering="crispEdges">
          <rect width={shape.size} height={shape.size} />
          <path d={shape.path} />
        </svg>
      </button>
      <p className="wallet-uri small" data-testid="wallet-link">{uri}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={copy} data-testid="wallet-copy">{t('wallet.copyLink')}</button>
        <span role="status" className="small copied" data-testid="wallet-copied">{note === '' ? '' : t(`wallet.${note}`)}</span>
      </div>
      <p className="small muted">{waiting ? t('wallet.waiting') : ''}</p>
    </div>
  );
}
