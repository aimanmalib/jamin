// Home depth strip (decision 0026): what stands behind the contract, each fact a link to where it can be checked.
// Every number is counted by web/data/depth.ts from repository files the build imports; none is written here.
import type { ReactNode } from 'react';
import featuresMd from '../../docs/FEATURES.md?raw';
import findingsMd from '../../docs/SOLIDCASH-FINDINGS.md?raw';
import testCases from '../../artifacts/solidhat-tests.json' with { type: 'json' };
import { useLang } from '../i18n.js';
import { config } from '../data/config.js';
import { mainnet } from '../data/examples.js';
import { depth } from '../data/depth.js';

const DEPTH = depth({ featuresMd, findingsMd, testCases, upstreamPrs: config.depth.upstreamPrs, run: mainnet });

/** A page of the repository on GitHub. */
function repo(path: string): string {
  return `${config.banner.repoUrl}/${path}`;
}

interface Fact { id: string; href: string; count: number; label: string; more?: { href: string; count: number; label: string } }

export function DepthStrip(): ReactNode {
  const { t, lang } = useLang();
  const n = (v: number): string => v.toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-US');
  const links = config.depth.links;
  const facts: Fact[] = [
    { id: 'features', href: '#/contract', count: DEPTH.features, label: t('depth.features') },
    { id: 'tests', href: repo(links.tests), count: DEPTH.tests, label: t('depth.tests') },
    { id: 'findings', href: repo(links.findings), count: DEPTH.findings, label: t('depth.findings'),
      more: { href: repo(links.upstream), count: DEPTH.upstreamPrs, label: t('depth.upstreamPrs') } },
    { id: 'scenarios', href: '#/lifecycle', count: DEPTH.scenarios, label: t('depth.scenarios'),
      more: { href: '#/lifecycle', count: DEPTH.transactions, label: t('depth.transactions') } },
  ];
  return (
    <section className="depth" aria-labelledby="depth-title">
      <h2 id="depth-title" className="stats-title">{t('depth.title')}</h2>
      <ul>
        {facts.map((f) => (
          <li key={f.id}>
            <a href={f.href} data-testid={`depth-${f.id}`}>
              <span className="depth-n">{n(f.count)}</span> {f.label}
            </a>
            {f.more && (
              <a className="depth-more" href={f.more.href} data-testid={`depth-${f.id}-more`}>
                {t('depth.arrow')} {n(f.more.count)} {f.more.label}
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="small muted depth-port">
        <a href={repo(links.porting)} data-testid="depth-ported">{t('depth.ported')}</a>
      </p>
    </section>
  );
}
