// The motif: two people either side of a locked box that holds the coins until the trade is settled.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';

export function Mark(): ReactNode {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" className="a-ink" />
      <rect x="8" y="14" width="16" height="12" rx="2" className="a-lamp" />
      <path d="M11 14v-3a5 5 0 0 1 10 0v3" fill="none" className="a-paper-stroke" strokeWidth="2.5" />
    </svg>
  );
}

function Person({ x, label }: { x: number; label: string }): ReactNode {
  return (
    <g transform={`translate(${x} 0)`}>
      <circle cx="0" cy="62" r="13" className="a-ink" />
      <path d="M-22 128c0-26 10-44 22-44s22 18 22 44z" className="a-ink" />
      <text x="0" y="150" textAnchor="middle" className="a-ink a-label">{label}</text>
    </g>
  );
}

/**
 * The trade in one loop (decision 0024): a coin leaves the seller, waits in the contract, goes on to the buyer; the
 * dispute branch draws down to a panel of three where two votes light up. Only transform, opacity and
 * stroke-dashoffset move (styles.css, hero-*); with reduced motion the frame is still: coin in the contract.
 */
export function HeroArt(): ReactNode {
  const { t } = useLang();
  return (
    <svg className="hero-art" viewBox="0 0 400 250" role="img" aria-labelledby="hero-art-title">
      <title id="hero-art-title">{t('home.artTitle')}</title>
      <rect x="0" y="126" width="400" height="3" rx="1.5" className="a-line" />
      <Person x={44} label={t('roles.seller')} />
      <Person x={356} label={t('roles.buyer')} />
      <path d="M74 100h66M260 100h66" className="a-river-stroke" strokeWidth="4" strokeDasharray="2 8"
        strokeLinecap="round" />
      <path d="M176 66v-12a24 24 0 0 1 48 0v12" className="a-ink-stroke" strokeWidth="8" />
      <rect x="150" y="66" width="100" height="62" rx="9" className="a-lamp a-ink-edge" strokeWidth="3" />
      <circle cx="200" cy="108" r="6" className="a-ink" />
      <path d="M197 111h6l2 11h-10z" className="a-ink" />
      <text x="200" y="146" textAnchor="middle" className="a-soft a-caption">{t('home.artContract')}</text>
      <path d="M200 154v34" className="a-ink-stroke hero-branch" strokeWidth="2.5" strokeDasharray="34"
        strokeLinecap="round" />
      <text x="208" y="176" className="a-soft a-caption">{t('home.artDispute')}</text>
      {[170, 200, 230].map((cx, i) => (
        <circle key={cx} cx={cx} cy="204" r="9"
          className={i < 2 ? `a-river hero-vote hero-vote-${i + 1}` : 'a-line'} />
      ))}
      <text x="200" y="236" textAnchor="middle" className="a-soft a-caption">{t('home.artPanel')}</text>
      <g className="hero-coin">
        <circle cx="200" cy="86" r="13" className="a-coin" strokeWidth="2" />
        <text x="200" y="89.5" textAnchor="middle" className="a-ink a-coin-text">BCH</text>
      </g>
    </svg>
  );
}
