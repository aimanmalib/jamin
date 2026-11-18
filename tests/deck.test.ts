// The event deck (tools/deck): the PDF the site serves is built from the current slide text, config and tokens; the
// slides follow the event template; every number on a slide is found in the section of the document it cites.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deckConfig, inputsHash, loadSlides, OUT, ROOT, STAMP } from '../tools/deck/deck.js';

const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');
const slides = loadSlides();
const texts = slides.flatMap((s) => [s.title, ...(s.lines ?? []), ...(s.items ?? []).map((i) => i.text)]);

/** The text under `## heading` of a markdown file, up to the next `## `. */
export function section(markdown: string, heading: string): string | undefined {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** Numbers as written in the text: 92, 6,888, 29.0.0, #8. */
export const numbers = (text: string): string[] => text.match(/\d[\d,.]*\d|\d/g) ?? [];

describe('deck', () => {
  it('follows the event template: six to eight slides, from Title to Thank you', () => {
    expect(slides.length).toBeGreaterThanOrEqual(6);
    expect(slides.length).toBeLessThanOrEqual(8);
    expect(slides[0]?.kind).toBe('title');
    expect(slides.at(-1)?.kind).toBe('thanks');
    expect(new Set(slides.map((s) => s.template)).size).toBe(slides.length);
  });

  it('is printed from the current inputs (rebuild with npx tsx tools/deck/build.ts)', () => {
    expect(read(STAMP).trim()).toBe(inputsHash());
    const pdf = readFileSync(resolve(ROOT, OUT));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length).toBe(slides.length);
  });

  it('cites a section that exists for every sourced item, and each of its numbers is in that section', () => {
    const sourced = slides.flatMap((s) => s.items ?? []).filter((i) => i.source);
    expect(sourced.length).toBeGreaterThan(0);
    for (const item of sourced) {
      const [file = '', heading = ''] = (item.source ?? '').split('#');
      const body = section(read(file), heading);
      expect(body, `${item.source}`).toBeDefined();
      for (const n of numbers(item.text)) expect(body, `${n} in ${item.source}`).toContain(n);
    }
  });

  it('puts a number on a slide only with its source', () => {
    for (const item of slides.flatMap((s) => s.items ?? []).filter((i) => !i.source)) {
      expect(numbers(item.text), item.text).toEqual([]);
    }
  });

  it('uses the house style: no long dashes or exclamation marks', () => {
    for (const t of texts) expect(t, t).not.toMatch(/[–—!]/);
  });

  it('is linked from the banner at the site address of the file the build serves', () => {
    const c = deckConfig();
    expect(c.deckUrl).toBe(`${c.site}/${OUT.replace(/^public\//, '')}`);
    expect(existsSync(resolve(ROOT, OUT))).toBe(true);
  });

  it('finds numbers and sections the way the checks above rely on', () => {
    expect(numbers('6,888 of 10,000 bytes on 29.0.0, #8.')).toEqual(['6,888', '10,000', '29.0.0', '8']);
    expect(section('## A\nx 1\n## B\ny', 'A')).toBe('x 1');
    expect(section('## A\nx', 'C')).toBeUndefined();
  });
});
