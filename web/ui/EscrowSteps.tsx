// The steps of one escrow on a real network, in order. A mined step shows its txid and block; a call the network
// refused (docs/decisions/0015) shows who signed it, why the contract forbids it, the rejection text as the node or
// server sent it, and the hash of the transaction that was never mined.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config, explorerLink } from '../data/config.js';
import { isRefused, type EscrowStep, type RefusedStep } from '../data/examples.js';

function Refused({ s }: { s: RefusedStep }): ReactNode {
  const { t } = useLang();
  return (
    <li className="refused" data-testid="refused-step">
      <strong className="refused-label">{t('lifecycle.refused')}</strong>{' '}
      {t('lifecycle.refusedBy', { step: t(`log.step.${s.step}`), party: t(`log.signer.${s.by}`) })}
      <p className="small">{t(`lifecycle.refusedWhy.${s.expected}`)}</p>
      <p className="small muted">{t('lifecycle.refusedText')}</p>
      <code className="server-error" data-testid="server-error">{s.serverError}</code>
      <p className="small muted">{t('lifecycle.rawHash')} <span className="txid">{s.rawTxHash}</span></p>
    </li>
  );
}

/** `link`: whether txids link to the mainnet explorer (regtest transactions have nowhere to link to). */
export function EscrowSteps({ steps, link }: { steps: EscrowStep[]; link: boolean }): ReactNode {
  const { t } = useLang();
  return (
    <ol className="escrow-steps">
      {steps.map((s) => (isRefused(s) ? <Refused key={s.rawTxHash} s={s} /> : (
        <li key={s.txid}>{t(`log.step.${s.step}`)}{' '}
          {link ? <a className="txid" href={explorerLink(config.explorer.mainnetTx, s.txid)}>{s.txid}</a>
            : <span className="txid">{s.txid}</span>}{' '}
          <span className="muted small">{s.height === undefined ? t('lifecycle.mempool')
            : t('lifecycle.block', { height: s.height })}{s.signer === 'wallet' ? `, ${t('lifecycle.walletSigned')}` : ''}</span>
        </li>
      )))}
    </ol>
  );
}
