// UI text: both language files carry the same keys, every literal key the web app asks for exists, and every
// contract error the simulator can name has a sentence.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { lookup } from '../web/text.js';
import { ERROR_NAMES } from '../web/sim/errors.js';
import { ACTIONS, STATUS } from '../web/sim/engine.js';

function keys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? sources(join(dir, d.name))
    : /\.tsx?$/.test(d.name) ? [readFileSync(join(dir, d.name), 'utf8')] : []);
}

describe('web text', () => {
  it('has the same keys in English and Malay', () => {
    expect(keys(ms).sort()).toEqual(keys(en).sort());
  });

  it('has every literal key the components use', () => {
    const used = sources('web').flatMap((s) => [...s.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1] ?? ''));
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((k) => lookup(en, k) === k)).toEqual([]);
  });

  it('names every error, action, state and log step', () => {
    const wanted = [...ERROR_NAMES, 'Rejected'].map((e) => `errors.${e}`)
      .concat(ACTIONS.flatMap((a) => [`actions.${a}.label`, `actions.${a}.who`, `log.step.${a}`]))
      .concat(STATUS.map((s) => `states.${s}`));
    expect(wanted.filter((k) => lookup(en, k) === k)).toEqual([]);
  });

  it('fills placeholders and falls back to the key', () => {
    expect(lookup(en, 'units.sats', { n: '20,000' })).toBe('20,000 sats');
    expect(lookup(en, 'no.such.key')).toBe('no.such.key');
  });
});
