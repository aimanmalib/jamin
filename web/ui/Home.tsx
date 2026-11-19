// First screen: one sentence, one action card with one primary button, the judges' strip. Then the mainnet demo
// escrow, the demo video and how it works.
import { Suspense, lazy, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { HeroArt } from './Art.js';
import { config, sitePath } from '../data/config.js';

// The demo card carries the SolidCash SDK: loaded after the first screen.
const DemoRelease = lazy(async () => ({ default: (await import('./DemoRelease.js')).DemoRelease }));

export function Home(): ReactNode {
  const { t } = useLang();
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div>
          <h1 id="home-title">{t('home.title')}</h1>
          <div className="card action">
            <h2 className="h3">{t('home.actionTitle')}</h2>
            <p className="muted small">{t('home.actionNote')}</p>
            <a className="btn btn-primary" href="#/try">{t('home.actionButton')}</a>
          </div>
          <p className="lede after">{t('home.lede')}</p>
        </div>
        <HeroArt />
      </section>
      <section className="judge" aria-labelledby="judge-title">
        <h2 id="judge-title" className="h3">{t('home.judgeTitle')}</h2>
        <ol>
          <li>{t('home.judge1')}</li>
          <li><a href="#/lifecycle">{t('home.judge2')}</a></li>
          <li><a href="#/contract">{t('home.judge3')}</a></li>
        </ol>
      </section>
      <Suspense fallback={null}><DemoRelease /></Suspense>
      {config.banner.videoUrl && <DemoVideo />}
      <section aria-labelledby="how-title">
        <h2 id="how-title">{t('home.howTitle')}</h2>
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
