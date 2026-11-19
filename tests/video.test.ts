// The demo video the site serves: the file and its poster are in public/ at the path of the configured URLs, the
// MP4 can start playing before it has fully loaded, the length the page states is the file's own, the web server
// gives /media/ its cache lifetime, and the README's first stop for judges links the video.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { renderTemplate } from '../src/deploy/site.js';
import raw from '../config/jamin.json' with { type: 'json' };

const ROOT = resolve(import.meta.dirname, '..');
const banner = raw.banner;
const publicFile = (url: string): Buffer => readFileSync(resolve(ROOT, 'public', new URL(url).pathname.slice(1)));

/** Seconds from the movie header (mvhd) of an MP4. */
export function mp4Seconds(mp4: Buffer): number {
  const at = mp4.indexOf('mvhd');
  if (at < 0) throw new Error('no mvhd box');
  const version = mp4[at + 4];
  const body = at + 8; // after version + flags
  if (version === 1) return Number(mp4.readBigUInt64BE(body + 20)) / mp4.readUInt32BE(body + 16);
  return mp4.readUInt32BE(body + 12) / mp4.readUInt32BE(body + 8);
}

describe('demo video', () => {
  it('is served from this site, next to its poster', () => {
    const site = loadConfig().site.url;
    expect(banner.videoUrl.startsWith(`${site}/media/`)).toBe(true);
    expect(banner.videoPosterUrl.startsWith(`${site}/media/`)).toBe(true);
    expect(publicFile(banner.videoPosterUrl).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('is an MP4 with its index before the media data, so it plays while loading', () => {
    const mp4 = publicFile(banner.videoUrl);
    expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(mp4.indexOf('moov')).toBeGreaterThan(0);
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat'));
  });

  it('states the length of the file, rounded up to whole seconds', () => {
    expect(banner.videoSeconds).toBe(Math.ceil(mp4Seconds(publicFile(banner.videoUrl))));
  });

  it('gets the configured cache lifetime from the web server', () => {
    const conf = renderTemplate(readFileSync(resolve(ROOT, 'deploy/nginx.conf.tmpl'), 'utf8'), {
      CSP: 'x', ASSET_MAX_AGE: '1', MEDIA_MAX_AGE: String(loadConfig().deploy.mediaMaxAgeSeconds) });
    const block = conf.slice(conf.indexOf('location /media/'), conf.indexOf('location / {'));
    expect(block).toContain(`max-age=${raw.deploy.mediaMaxAgeSeconds}"`);
    expect(block).toContain('try_files $uri =404;');
  });

  it('is the first link in the README section for judges', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const judges = readme.slice(readme.indexOf('## For judges: one minute'));
    const firstItem = judges.split('\n').find((l) => l.startsWith('- '));
    expect(firstItem).toContain(banner.videoUrl);
    expect(firstItem).toContain(`${banner.videoSeconds} seconds`);
  });
});
