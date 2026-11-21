// The "new project" note (event rule: a project started for the event says so): the banner shows it with a link to the
// first commit, both read from config/jamin.json and lang/*.json, and the README carries the same line above the
// judges' section.
import { readFileSync } from 'node:fs';
import { decodeCashAddress } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import raw from '../config/jamin.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { bannerNote } from '../web/ui/banner-note.js';
import { lookup } from '../web/text.js';

const banner = raw.banner;
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const commitUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[0-9a-f]{40}$/;

describe('banner note', () => {
  it('is switched on in config with a full first-commit URL inside the repository', () => {
    expect(banner.note).toBe(true);
    expect(banner.firstCommitUrl).toMatch(commitUrl);
    expect(banner.firstCommitUrl.startsWith(`${banner.repoUrl}/commit/`)).toBe(true);
  });

  it('takes its text from the language files and its link from config, in English and Malay', () => {
    for (const dict of [en, ms]) {
      const note = bannerNote(banner, (key) => lookup(dict, key));
      expect(note).toEqual({ text: dict.banner.note, linkText: dict.banner.firstCommit, href: banner.firstCommitUrl });
      expect(note?.text).toMatch(/14 November/);
    }
    expect(ms.banner.note).not.toBe(en.banner.note);
  });

  it('is not shown when switched off or without a URL', () => {
    const t = (key: string): string => lookup(en, key);
    expect(bannerNote({ ...banner, note: false }, t)).toBeNull();
    expect(bannerNote({ ...banner, firstCommitUrl: '' }, t)).toBeNull();
  });

  it('is repeated in the README above the judges section, with the same link', () => {
    const top = readme.slice(0, readme.indexOf('## For judges'));
    expect(top).toContain(en.banner.note.replace(/\.$/, ''));
    expect(top).toContain(`(${banner.firstCommitUrl})`);
  });
});

// Event rule: one prize and Community Choice vote address per project. The banner shows and copies it, so a typo would
// send a vote somewhere nobody can spend; the checksum catches that, and the address is read from config only.
describe('banner prize address', () => {
  it('is a valid mainnet CashTokens address', () => {
    const decoded = decodeCashAddress(banner.prizeAddress);
    expect(typeof decoded, String(decoded)).toBe('object');
    if (typeof decoded === 'string') return;
    expect(decoded.prefix).toBe('bitcoincash');
    expect(decoded.type).toBe('p2pkhWithTokens');
    expect(banner.prizeAddress.startsWith('bitcoincash:z')).toBe(true);
  });
});
