// The event banner on every page: event name, bounty, source link, prize address with a copy button, slides when
// config.banner.deckUrl is set, the demo video when config.banner.videoUrl is set, and a "new project" line with a link
// to the first commit when config.banner.note is true. Elements without a value are not shown.
import { useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config } from '../data/config.js';
import { bannerNote } from './banner-note.js';

/** `bitcoincash:zrj2rs...u2qv`: the prefix, the first six and the last four characters; the copy button copies it all. */
export function shorten(address: string): string {
  const [prefix, body = ''] = address.includes(':') ? address.split(':') : ['', address];
  if (body.length <= 12) return address;
  return `${prefix ? `${prefix}:` : ''}${body.slice(0, 6)}...${body.slice(-4)}`;
}

export function Banner(): ReactNode {
  const { t } = useLang();
  const b = config.banner;
  const [copied, setCopied] = useState(false);
  const note = bannerNote(b, t);
  const copy = (): void => {
    void navigator.clipboard?.writeText(b.prizeAddress).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <aside className="banner" aria-label={t('banner.label')}>
      <div className="wrap">
        <strong>{b.event}</strong>
        <span>{t('banner.bounty', { bounty: b.bounty })}</span>
        {b.repoUrl && <a href={b.repoUrl}>{t('banner.repo')}</a>}
        {b.deckUrl && <a href={b.deckUrl}>{t('banner.deck')}</a>}
        {b.videoUrl && <a href={b.videoUrl}>{t('banner.video')}</a>}
        {b.prizeAddress && (
          <span className="prize">
            <span>{t('banner.prizeAddress')}</span>
            <code title={b.prizeAddress} aria-label={b.prizeAddress}>{shorten(b.prizeAddress)}</code>
            <button type="button" className="btn-copy" onClick={copy}>{copied ? t('banner.copied') : t('banner.copy')}</button>
          </span>
        )}
        {note && (
          <p className="banner-note" data-testid="banner-note">
            <span className="banner-note-text" title={note.text}>{note.text}</span>
            <a href={note.href}>{note.linkText}</a>
          </p>
        )}
      </div>
    </aside>
  );
}
