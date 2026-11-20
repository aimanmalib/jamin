// "Release on mainnet": the public demo escrow, already created, funded and marked paid. Pressing the button signs
// `release` in this page with the public demo seller key and broadcasts it; `?demo=dry` signs and sends nothing.
// The escrow's state is read from the chain, so a release by an earlier visitor shows as such. A pool of demo escrows
// waits (decision 0021): the card offers the first still at `paid`, and after a release points to the next one. When
// none waits, the pool's list file says when the host's cron runs next (the card adds the minutes a staging takes)
// or that the pool is closed.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config, explorerLink } from '../data/config.js';
import { demo, lastTx, offer, release, type DemoTarget, type Offer } from '../demo/run.js';
import { fetchPool, poolNext, type PoolInfo } from '../demo/pick.js';
import { announceRelease } from '../demo/events.js';
import type { DemoStatus, Released } from '../../src/demo/escrow.js';

type View =
  | { kind: 'loading' } | { kind: 'none' } | { kind: 'error' }
  | { kind: 'status'; target: DemoTarget; status: DemoStatus; last?: string | undefined; pool?: PoolInfo | undefined }
  | { kind: 'working'; target: DemoTarget }
  | { kind: 'done'; target: DemoTarget; result: Released; next?: Offer | undefined; pool?: PoolInfo | undefined };

/** "The next one is ready in about N min" or "the pool is closed", when no demo escrow waits. */
function PoolLine({ pool }: { pool: PoolInfo | undefined }): ReactNode {
  const { t } = useLang();
  const next = pool && poolNext(pool, Date.now(), demo.pool.estimateReadyMinutes);
  if (!next) return null;
  return <p data-testid="demo-pool-next">{next.kind === 'closed' ? t('demo.poolClosed')
    : t('demo.poolSoon', { minutes: String(next.minutes) })}</p>;
}

function TxLink({ txid, live }: { txid: string; live: boolean }): ReactNode {
  return live ? <a className="txid" href={explorerLink(config.explorer.mainnetTx, txid)}>{txid}</a>
    : <span className="txid">{txid}</span>;
}

/** `focusOnMount`: the card replaces the button that opened it, so keyboard focus moves to the card. */
export function DemoRelease({ focusOnMount = false }: { focusOnMount?: boolean }): ReactNode {
  const { t } = useLang();
  const self = useRef<HTMLElement>(null);
  useEffect(() => { if (focusOnMount) self.current?.focus(); }, [focusOnMount]);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [addresses, setAddresses] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async (): Promise<View> => {
      const o = await offer();
      if (!o) return { kind: 'none' };
      setAddresses(o.addresses);
      return { kind: 'status', target: o.target, status: o.status,
        last: o.status === 'paid' ? undefined : await lastTx(o.target), pool: o.pool };
    })().then((v) => { if (alive) setView(v); }, () => { if (alive) setView({ kind: 'error' }); });
    return () => { alive = false; };
  }, []);

  const press = (target: DemoTarget): void => {
    setView({ kind: 'working', target });
    release(target).then(async (result) => {
      setView({ kind: 'done', target, result });
      // A sent release ends this escrow: look for the next one still waiting. A dry one changes nothing.
      if (!result.sent) return;
      announceRelease(target.address);
      const next = target.mode === 'mock' ? undefined
        : await offer(target.mode, new Set([target.address]), addresses).catch(() => undefined);
      if (next?.status === 'paid') setView({ kind: 'done', target, result, next });
      else setView({ kind: 'done', target, result, pool: next?.pool ?? await fetchPool(demo.pool.indexPath) });
    }, () => setView({ kind: 'error' }));
  };

  const live = (target: DemoTarget): boolean => target.mode !== 'mock';
  return (
    <section className="card demo" aria-labelledby="demo-title" data-testid="demo-release" ref={self}
      tabIndex={-1}>
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
      {view.kind === 'status' && view.status !== 'paid' && <PoolLine pool={view.pool} />}
      {view.kind === 'working' && <p role="status">{t('demo.working')}</p>}
      {view.kind === 'done' && (
        <p role="status" data-testid="demo-result">
          {t(view.result.sent ? 'demo.sent' : 'demo.signed', { bytes: view.result.bytes.toLocaleString('en') })}
          {' '}<TxLink txid={view.result.txid} live={view.result.sent && live(view.target)} />
        </p>
      )}
      {view.kind === 'done' && !view.next && <PoolLine pool={view.pool} />}
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
