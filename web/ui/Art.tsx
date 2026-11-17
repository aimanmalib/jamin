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
      <circle cx="0" cy="92" r="16" className="a-ink" />
      <path d="M-26 170c0-30 12-52 26-52s26 22 26 52z" className="a-ink" />
      <text x="0" y="196" textAnchor="middle" className="a-ink a-label">{label}</text>
    </g>
  );
}

export function HeroArt(): ReactNode {
  const { t } = useLang();
  return (
    <svg className="hero-art" viewBox="0 0 400 220" role="img" aria-labelledby="hero-art-title">
      <title id="hero-art-title">{t('home.artTitle')}</title>
      <rect x="0" y="176" width="400" height="4" rx="2" className="a-line" />
      <Person x={52} label={t('roles.seller')} />
      <Person x={348} label={t('roles.buyer')} />
      <path d="M86 130h60M254 130h60" className="a-river-stroke" strokeWidth="4" strokeDasharray="2 8" strokeLinecap="round" />
      <path d="M170 92v-14a30 30 0 0 1 60 0v14" className="a-ink-stroke" strokeWidth="9" />
      <rect x="150" y="92" width="100" height="84" rx="10" className="a-lamp a-ink-edge" strokeWidth="3" />
      <circle cx="200" cy="124" r="9" className="a-ink" />
      <path d="M196 128h8l3 22h-14z" className="a-ink" />
      <circle cx="146" cy="58" r="14" className="a-coin" strokeWidth="2" />
      <text x="146" y="62" textAnchor="middle" className="a-ink a-coin-text">BCH</text>
      <text x="200" y="210" textAnchor="middle" className="a-soft a-caption">
        {t('home.artContract')}</text>
    </svg>
  );
}
