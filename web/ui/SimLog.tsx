// The simulator's transaction log, newest first. Accepted calls show their txid and size; rejected calls the
// contract error's name and what it means.
import { useEffect, useRef, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import type { LogEntry } from '../sim/engine.js';

/** The two signatures of a dispute decision, so the 2-of-3 panel is visible in the log. */
function Signatures({ entry }: { entry: LogEntry }): ReactNode {
  const { t } = useLang();
  if (!entry.signers) return null;
  const names = entry.signers.map((n) => t(`log.signer.${n}`)).join(', ');
  return <div className="small" data-testid="signatures">{t('log.signatures', { names })}</div>;
}

/** The newest entry again, right under the action buttons, so a phone shows the result without scrolling. */
export function LastResult({ entry }: { entry: LogEntry | undefined }): ReactNode {
  const { t } = useLang();
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); }, [entry]);
  if (!entry) return null;
  return (
    <p ref={ref} className={`last ${entry.ok ? 'ok' : 'no'}`} role="status" data-testid="last-result">
      <strong>{entry.ok ? t('log.accepted') : t('log.rejected')}</strong>: {t(`log.step.${entry.action}`)}
      {!entry.ok && <> <code>{entry.error}</code> {t(`errors.${entry.error ?? 'Rejected'}`)}</>}
    </p>
  );
}

export function SimLog({ log }: { log: LogEntry[] }): ReactNode {
  const { t } = useLang();
  const rows = log.map((entry, i) => ({ entry, i })).reverse();
  return (
    <ol className="log" aria-live="polite" reversed>
      {rows.map(({ entry, i }) => (
        <li key={i} className={entry.ok ? 'ok' : 'no'} data-testid="log-entry" data-ok={entry.ok}>
          <div className="head">
            {entry.ok ? t('log.accepted') : t('log.rejected')}: {t(`roles.${entry.actor}`)}, {t(`log.step.${entry.action}`)}
          </div>
          {entry.ok && entry.txid && (
            <div className="txid">{t('log.tx', { bytes: entry.bytes ?? 0 })} {entry.txid}</div>
          )}
          <Signatures entry={entry} />
          {entry.ok && (entry.walletInputs ?? 0) > 0 && (
            <div className="small" data-testid="wallet-inputs">{t('log.walletInputs', { count: entry.walletInputs ?? 0 })}</div>
          )}
          {entry.ok && entry.action === 'wait' && <div className="small muted">{t('log.waited')}</div>}
          {!entry.ok && (
            <div className="small">
              <code data-testid="error-name">{entry.error}</code> {t(`errors.${entry.error ?? 'Rejected'}`)}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
