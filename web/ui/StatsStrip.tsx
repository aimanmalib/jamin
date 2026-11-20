// Home stats strip (decision 0023): escrows on mainnet, releases on mainnet, coins ever locked, calls the network
// refused, the current block. The counts come from examples/mainnet.json (plus pool escrows the host lists but the
// file does not record yet, and demo escrows seen released since: read from the chain while the page is visible, or
// released by this page); the block comes from Electrum and keeps updating. When the network fails the recorded
// numbers stay and the strip says the live data is unavailable.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import demoRaw from '../../config/demo.json' with { type: 'json' };
import { useLang } from '../i18n.js';
import { config } from '../data/config.js';
import {
  bchText, recordedStats, releaseCount, secondsAgo, statsPollMs, tokenText, unrecordedPool, unreleasedDemo,
} from '../data/stats.js';
import { fetchIndex } from '../demo/pick.js';
import { RELEASED_EVENT } from '../demo/events.js';
import { electrumTip, mockTip, statsMode } from '../net/tip.js';
import { startPolling } from '../wallet/poll.js';

interface Tip { height: number; at: number }

export function StatsStrip(): ReactNode {
  const { t, lang } = useLang();
  const locale = lang === 'ms' ? 'ms-MY' : 'en-US';
  const recorded = useMemo(() => recordedStats(), []);
  const [pool, setPool] = useState(0);
  const [found, setFound] = useState<ReadonlySet<string>>(new Set());
  const watch = useRef<string[]>([]);
  const [tip, setTip] = useState<Tip>();
  const [down, setDown] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void fetchIndex(demoRaw.pool.indexPath).then((list) => {
      if (!live) return;
      setPool(unrecordedPool(list));
      watch.current = unreleasedDemo(list);
    });
    const seen = (e: Event): void => {
      const address = (e as CustomEvent<string>).detail;
      if (typeof address === 'string') setFound((f) => new Set([...f, address]));
    };
    addEventListener(RELEASED_EVENT, seen);
    return () => { live = false; removeEventListener(RELEASED_EVENT, seen); };
  }, []);

  useEffect(() => {
    const mode = statsMode(location.search, location.hash);
    const source = mode === 'mock' ? mockTip() : electrumTip();
    // Released demo escrows are read from the chain only in live mode; the release module loads on first use.
    let releases: { released(a: string[]): Promise<string[]> } | undefined;
    const checkReleases = async (): Promise<void> => {
      const left = watch.current;
      if (mode === 'mock' || left.length === 0) return;
      releases ??= (await import('../demo/run.js')).releaseWatcher();
      const done = await releases.released(left);
      if (done.length === 0) return;
      watch.current = left.filter((a) => !done.includes(a));
      setFound((f) => new Set([...f, ...done]));
    };
    const ticker = startPolling(async () => {
      try {
        const height = await source.height();
        setTip({ height, at: Date.now() });
        setDown(false);
        await checkReleases().catch(() => undefined);
      } catch {
        setDown(true);
      }
    }, statsPollMs(mode, config.stats));
    const clock = setInterval(() => { setNow(Date.now()); }, config.stats.tickMs);
    return () => { ticker.stop(); source.close(); clearInterval(clock); };
  }, []);

  const n = (v: number): string => v.toLocaleString(locale);
  const pusd = config.tokens.pusd;
  return (
    <section className="stats" aria-labelledby="stats-title">
      <h2 id="stats-title" className="stats-title">{t('stats.title')}</h2>
      <dl>
        <div>
          <dt>{t('stats.escrows')}</dt>
          <dd data-testid="stats-escrows">{n(recorded.escrows + pool)}</dd>
        </div>
        <div>
          <dt>{t('stats.releases')}</dt>
          <dd data-testid="stats-releases"><a href="#/lifecycle">{n(releaseCount(found))}</a></dd>
        </div>
        <div>
          <dt>{t('stats.locked')}</dt>
          <dd data-testid="stats-locked">{bchText(recorded.lockedSats, locale)} BCH</dd>
          <dd className="muted small" data-testid="stats-locked-token">
            + {tokenText(recorded.lockedUnits, pusd.decimals, locale)} {pusd.symbol}
          </dd>
        </div>
        <div>
          <dt>{t('stats.refused')}</dt>
          <dd data-testid="stats-refused"><a href="#/lifecycle">{n(recorded.refused)}</a></dd>
        </div>
        <div>
          <dt>{t('stats.block')}</dt>
          <dd data-testid="stats-block">{tip ? n(tip.height) : '...'}</dd>
          <dd className="muted small" data-testid="stats-age" aria-live="off">
            {down ? t('stats.unavailable')
              : tip ? t('stats.updated', { seconds: n(secondsAgo(tip.at, now)) }) : t('stats.loading')}
          </dd>
        </div>
      </dl>
    </section>
  );
}
