// "Release on mainnet": the public demo escrow, already created, funded and marked paid. Pressing the button signs
// `release` in this page with the public demo seller key and broadcasts it; `?demo=dry` signs and sends nothing.
// The escrow's state is read from the chain, so a release by an earlier visitor shows as such. A pool of demo escrows
// waits (decision 0021): the card offers the first still at `paid`, and after a release points to the next one.
import { useEffect, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config, explorerLink } from '../data/config.js';
import { demo, lastTx, offer, release, type DemoTarget, type Offer } from '../demo/run.js';
import type { DemoStatus, Released } from '../../src/demo/escrow.js';

type View =
  | { kind: 'loading' } | { kind: 'none' } | { kind: 'error' }
  | { kind: 'status'; target: DemoTarget; status: DemoStatus; last?: string | undefined }
  | { kind: 'working'; target: DemoTarget }
  | { kind: 'done'; target: DemoTarget; result: Released; next?: Offer | undefined };

function TxLink({ txid, live }: { txid: string; live: boolean }): ReactNode {
  return live ? <a className="txid" href={explorerLink(config.explorer.mainnetTx, txid)}>{txid}</a>
    : <span className="txid">{txid}</span>;
}

export function DemoRelease(): ReactNode {
  const { t } = useLang();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [addresses, setAddresses] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async (): Promise<View> => {
      const o = await offer();
      if (!o) return { kind: 'none' };
      setAddresses(o.addresses);
      return { kind: 'status', target: o.target, status: o.status,
        last: o.status === 'paid' ? undefined : await lastTx(o.target) };
    })().then((v) => { if (alive) setView(v); }, () => { if (alive) setView({ kind: 'error' }); });
    return () => { alive = false; };
  }, []);

  const press = (target: DemoTarget): void => {
    setView({ kind: 'working', target });
    release(target).then(async (result) => {
      setView({ kind: 'done', target, result });
      // A sent release ends this escrow: look for the next one still waiting. A dry one changes nothing.
      if (!result.sent || target.mode === 'mock') return;
      const next = await offer(target.mode, new Set([target.address]), addresses).catch(() => undefined);
      if (next?.status === 'paid') setView({ kind: 'done', target, result, next });
    }, () => setView({ kind: 'error' }));
  };

  const live = (target: DemoTarget): boolean => target.mode !== 'mock';
  return (
    <section className="card demo" aria-labelledby="demo-title" data-testid="demo-release">
      <h2 id="demo-title" className="h3">{t('demo.title')}</h2>
      <p className="muted small">{t('demo.note', { max: demo.maxSats.toLocaleString('en') })}</p>
      {view.kind === 'loading' && <p className="muted" role="status">{t('demo.reading')}</p>}
      {view.kind === 'none' && <p className="notice" data-testid="demo-none">{t('demo.none')}</p>}
      {view.kind === 'error' && <p className="notice" role="alert">{t('demo.failed')}</p>}
      {view.kind === 'status' && view.status === 'paid' && (
        <>
          <p>{t('demo.ready', { sats: demo.escrowSats.toLocaleString('en') })}</p>
          {view.target.mode === 'dry' && <p className="muted small">{t('demo.dryNote')}</p>}
          <button type="button" className="btn" onClick={() => press(view.target)}>
            {t(view.target.mode === 'dry' ? 'demo.buttonDry' : 'demo.button')}</button>
        </>
      )}
      {view.kind === 'status' && view.status !== 'paid' && (
        <p data-testid="demo-closed">{t('demo.closed', { status: t(`demo.status.${view.status}`) })}
          {view.last && <> <TxLink txid={view.last} live={live(view.target)} /></>}</p>
      )}
      {view.kind === 'working' && <p role="status">{t('demo.working')}</p>}
      {view.kind === 'done' && (
        <p role="status" data-testid="demo-result">
          {t(view.result.sent ? 'demo.sent' : 'demo.signed', { bytes: view.result.bytes.toLocaleString('en') })}
          {' '}<TxLink txid={view.result.txid} live={view.result.sent && live(view.target)} />
        </p>
      )}
      {view.kind === 'done' && view.next && (
        <p data-testid="demo-next">{t('demo.next')}{' '}
          <button type="button" className="btn" onClick={() => view.next &&
            setView({ kind: 'status', target: view.next.target, status: view.next.status })}>{t('demo.nextButton')}</button>
        </p>
      )}
      {view.kind !== 'none' && view.kind !== 'loading' && 'target' in view && (
        <p className="small muted">{t('demo.escrow')}{' '}
          {live(view.target) ? <a className="txid" href={explorerLink(config.explorer.mainnetAddress, view.target.address)}>
            {view.target.address}</a> : <span className="txid">{view.target.address}</span>}</p>
      )}
    </section>
  );
}
