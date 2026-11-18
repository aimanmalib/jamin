// Page shell: event banner, header with the tabs and language toggle, the current tab, footer. Tabs are hash routes
// (#/try, #/wallet, #/lifecycle, #/contract) so the app is one static page.
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useLang } from './i18n.js';
import { config } from './data/config.js';
import { Banner } from './ui/Banner.js';
import { Home } from './ui/Home.js';
import { TryIt } from './ui/TryIt.js';
import { Lifecycle } from './ui/Lifecycle.js';
import { ContractView } from './ui/ContractView.js';

// The wallet tab carries the SDK's Electrum provider and the WizardConnect packages: loaded only when opened.
const WalletTab = lazy(async () => ({ default: (await import('./ui/WalletTab.js')).WalletTab }));
import { Mark } from './ui/Art.js';
import { TABS, hrefOf, tabFromHash, type Tab } from './route.js';

function useTab(): Tab {
  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash));
  useEffect(() => {
    const on = (): void => { setTab(tabFromHash(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return tab;
}

export function App(): ReactNode {
  const { t, lang, setLang } = useLang();
  const tab = useTab();
  useEffect(() => { document.title = `${t(`tabs.${tab}`)} · ${t('app.name')}`; }, [tab, t]);
  return (
    <>
      <a className="skip" href="#main">{t('app.skip')}</a>
      <Banner />
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#/"><Mark />{t('app.name')}</a>
          <nav aria-label={t('app.tabsLabel')}>
            <ul className="tabs">
              {TABS.map((name) => (
                <li key={name}>
                  <a href={hrefOf(name)} aria-current={tab === name ? 'page' : undefined}>{t(`tabs.${name}`)}</a>
                </li>
              ))}
            </ul>
          </nav>
          <button type="button" className="btn-lang" lang={lang === 'en' ? 'ms' : 'en'}
            onClick={() => setLang(lang === 'en' ? 'ms' : 'en')}>{t('app.languageToggle')}</button>
        </div>
      </header>
      <main id="main" className="wrap" tabIndex={-1}>
        {tab === 'home' && <Home />}
        {tab === 'try' && <TryIt />}
        {tab === 'wallet' && <Suspense fallback={<p className="muted">{t('wallet.loading')}</p>}><WalletTab /></Suspense>}
        {tab === 'lifecycle' && <Lifecycle />}
        {tab === 'contract' && <ContractView />}
      </main>
      <footer>
        <div className="wrap">
          <p>{t('footer.what')}</p>
          <p>{t('footer.license')} · <a href={config.banner.repoUrl}>{t('banner.repo')}</a></p>
        </div>
      </footer>
    </>
  );
}
