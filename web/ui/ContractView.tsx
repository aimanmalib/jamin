// "Contract": the SolidCash sources with line numbers, and the feature table of docs/FEATURES.md whose references
// jump to the line they name.
import { useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config } from '../data/config.js';
import { parseFeatures, type SourceRef } from '../data/features.js';
import featuresMd from '../../docs/FEATURES.md?raw';

const SOURCES = import.meta.glob<string>('../../contracts/*.scash', { query: '?raw', import: 'default', eager: true });
const FEATURES = parseFeatures(featuresMd);

function sourceOf(file: string): string {
  return SOURCES[`../../contracts/${file}`] ?? '';
}

export function ContractView(): ReactNode {
  const { t } = useLang();
  const files = config.web.contracts.filter((f) => sourceOf(f) !== '');
  const [hit, setHit] = useState<SourceRef>({ file: files[0] ?? '', line: 0 });
  const show = (ref: SourceRef): void => {
    setHit(ref);
    requestAnimationFrame(() => document.getElementById(`L${ref.line}`)?.scrollIntoView({ block: 'center' }));
    document.getElementById('source-h')?.scrollIntoView();
  };
  return (
    <>
      <h1>{t('contract.title')}</h1>
      <p className="lede muted">{t('contract.lede')}</p>
      <section aria-labelledby="features-h">
        <h2 id="features-h">{t('contract.featuresTitle', { count: FEATURES.length })}</h2>
        <ol className="features">
          {FEATURES.map((f) => (
            <li key={f.n} className="card">
              <strong>{f.name}</strong>
              <div>{f.refs.map((r) => (
                <button key={`${r.file}:${r.line}`} type="button" className="ref" onClick={() => show(r)}>
                  {r.file}:{r.line}</button>
              )).concat(f.code.map((c) => <code key={c} className="ref-code">{c}</code>))
                .reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}</div>
              <div className="small muted">{t('contract.testedBy')} {f.test}</div>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="source-h">
        <h2 id="source-h">{t('contract.sourceTitle')}</h2>
        <div className="file-tabs" role="group" aria-label={t('contract.filesLabel')}>
          {files.map((f) => (
            <button key={f} type="button" className="btn" aria-pressed={hit.file === f}
              onClick={() => setHit({ file: f, line: 0 })}>{f}</button>
          ))}
        </div>
        <pre className="source" tabIndex={0} aria-label={hit.file} data-testid="source">
          {sourceOf(hit.file).split('\n').map((text, i) => (
            <span key={i} id={`L${i + 1}`} data-n={i + 1} className={`ln${i + 1 === hit.line ? ' hit' : ''}`}>{text}</span>
          ))}
        </pre>
      </section>
    </>
  );
}
