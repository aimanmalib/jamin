import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

function keys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('project config', () => {
  const config = loadConfig();

  it('caps the mainnet budget at 0.02 BCH', () => {
    expect(Number.isSafeInteger(config.mainnet.budgetSats)).toBe(true);
    expect(config.mainnet.budgetSats).toBeGreaterThan(0);
    expect(config.mainnet.budgetSats).toBeLessThanOrEqual(2_000_000);
  });

  it('assigns each role its own derivation index', () => {
    const indexes = Object.values(config.wallet.roles);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it('keeps fee settings in range', () => {
    expect(config.escrow.feeBps).toBeGreaterThanOrEqual(0);
    expect(config.escrow.feeBps).toBeLessThan(10_000);
    expect(config.escrow.sellerWaitingTimeSeconds).toBeGreaterThanOrEqual(config.escrow.minSellerWaitingTimeSeconds);
    expect(config.tokens.pusd.category).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has the same text keys in English and Malay', () => {
    const read = (lang: string) => JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')) as unknown;
    expect(keys(read('ms')).sort()).toEqual(keys(read('en')).sort());
  });
});
