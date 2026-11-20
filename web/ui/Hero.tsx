// The first screen (decision 0024): one sentence, the primary "Release on mainnet" button and the simulator as the
// second choice, beside the animated trade. The demo card and its SolidCash SDK chunk load only when the button is
// pressed; the card then reads the escrow from the chain and shows what pressing its own button will send.
import { Suspense, lazy, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { HeroArt } from './Art.js';

const DemoRelease = lazy(async () => ({ default: (await import('./DemoRelease.js')).DemoRelease }));

export function Hero(): ReactNode {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <section className="hero" aria-labelledby="home-title">
      <div className="hero-text">
        <h1 id="home-title">{t('home.title')}</h1>
        <p className="lede">{t('home.heroNote')}</p>
        {open && (
          <Suspense fallback={<p className="muted" role="status">{t('demo.reading')}</p>}>
            <DemoRelease focusOnMount />
          </Suspense>
        )}
        <div className="hero-actions">
          {!open && (
            <button type="button" className="btn btn-primary" data-testid="hero-release" onClick={() => setOpen(true)}>
              {t('home.heroRelease')}</button>
          )}
          <a className="btn" href="#/try" data-testid="hero-try">{t('home.heroTry')}</a>
        </div>
      </div>
      <HeroArt />
    </section>
  );
}
