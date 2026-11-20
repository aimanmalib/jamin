// The "new project" line in the event banner: shown when config.banner.note is true and the first commit URL is set,
// so a judge can check that the work started after the event did. No React here, so tests can import it.

export interface BannerNoteConfig { note?: boolean; firstCommitUrl?: string }
export interface BannerNote { text: string; linkText: string; href: string }

type Translate = (key: string) => string;

/** The note and its link, or null when the banner should not show one. */
export function bannerNote(banner: BannerNoteConfig, t: Translate): BannerNote | null {
  if (!banner.note || !banner.firstCommitUrl) return null;
  return { text: t('banner.note'), linkText: t('banner.firstCommit'), href: banner.firstCommitUrl };
}
