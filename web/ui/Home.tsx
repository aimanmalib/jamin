// First screen: the hero (one sentence, "Release on mainnet", the simulator second), then the stats strip, the judges'
// strip, the demo video and how it works.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { Hero } from './Hero.js';
import { config, sitePath } from '../data/config.js';
import { StatsStrip } from './StatsStrip.js';

export function Home(): ReactNode {
  const { t } = useLang();
  return (
    <>
      <Hero />
      <StatsStrip />
      <section className="judge" aria-labelledby="judge-title">
        <h2 id="judge-title" className="h3">{t('home.judgeTitle')}</h2>
        <ol>
          <li>{t('home.judge1')}</li>
          <li><a href="#/lifecycle">{t('home.judge2')}</a></li>
          <li><a href="#/contract">{t('home.judge3')}</a></li>
        </ol>
      </section>
      {config.banner.videoUrl && <DemoVideo />}
      <section aria-labelledby="how-title">
        <h2 id="how-title">{t('home.howTitle')}</h2>
        <p className="lede">{t('home.lede')}</p>
        <div className="steps3">
          {(['1', '2', '3'] as const).map((n) => (
            <article className="card" key={n}>
              <h3>{t(`home.how${n}Title`)}</h3>
              <p className="muted">{t(`home.how${n}`)}</p>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="limits-title">
        <h2 id="limits-title">{t('home.limitsTitle')}</h2>
        <ul>
          <li>{t('home.limit1')}</li>
          <li>{t('home.limit2')}</li>
          <li>{t('home.limit3', { reserve: config.escrow.containerReserveSats.toLocaleString('en') })}</li>
        </ul>
      </section>
    </>
  );
}

/** The recorded demo. Nothing is downloaded until the visitor presses play. */
function DemoVideo(): ReactNode {
  const { t } = useLang();
  const b = config.banner;
  const src = sitePath(b.videoUrl);
  return (
    <section className="demo-video" aria-labelledby="video-title">
      <h2 id="video-title" className="h3">{t('home.videoTitle', { seconds: String(b.videoSeconds) })}</h2>
      <p className="muted small">{t('home.videoNote')}</p>
      <video controls preload="none" playsInline poster={sitePath(b.videoPosterUrl)} aria-labelledby="video-title">
        <source src={src} type="video/mp4" />
        <a href={src}>{t('home.videoFallback')}</a>
      </video>
    </section>
  );
}
