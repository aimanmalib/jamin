// The Home hero (decision 0024): one sentence of at most 14 words in both languages, and an animation that moves only
// transform, opacity and stroke-dashoffset (an animated blur or backdrop filter crashes WebKit) and only when the
// visitor has not asked for reduced motion.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');

/** Each `@keyframes hero-*` block with the properties its frames set. */
function heroKeyframes(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const m of source.matchAll(/@keyframes\s+(hero-[\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    const props = [...(m[2] ?? '').matchAll(/([\w-]+)\s*:/g)].map((p) => p[1] ?? '');
    found.set(m[1] ?? '', [...new Set(props)]);
  }
  return found;
}

/** Selectors that start a `hero-*` animation outside a `prefers-reduced-motion: no-preference` block. */
function unguardedAnimations(source: string): string[] {
  const guarded = /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g;
  const outside = source.replace(guarded, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  return [...outside.matchAll(/([^{}]+)\{[^}]*animation[^:]*:\s*hero-/g)].map((m) => (m[1] ?? '').trim());
}

describe('home hero', () => {
  it('says what the site does in one sentence pair of at most 14 words, in English and Malay', () => {
    for (const title of [en.home.title, ms.home.title]) {
      expect(title.split(/\s+/).length).toBeLessThanOrEqual(14);
    }
  });

  it('animates only transform, opacity and stroke-dashoffset', () => {
    const frames = heroKeyframes(css);
    expect([...frames.keys()].sort()).toEqual(['hero-branch', 'hero-coin', 'hero-vote']);
    for (const [name, props] of frames) {
      expect(props.filter((p) => !['transform', 'opacity', 'stroke-dashoffset'].includes(p)), name).toEqual([]);
    }
  });

  it('starts every hero animation only without a reduced-motion preference', () => {
    expect(unguardedAnimations(css)).toEqual([]);
  });

  it('catches a frame that animates a filter, and an animation outside the guard', () => {
    expect(heroKeyframes('@keyframes hero-x { 0% { opacity: 0; } 100% { filter: blur(2px); } }').get('hero-x'))
      .toEqual(['opacity', 'filter']);
    expect(unguardedAnimations('.hero-coin { animation: hero-coin 7s infinite; }')).toEqual(['.hero-coin']);
  });
});
