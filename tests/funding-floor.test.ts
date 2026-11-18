// The funding floor of a mainnet run: a run of branch B alone needs only its fees and reserves (decision 0012), any
// run with a BCH branch keeps the full floor (decision 0011).
import { describe, expect, it } from 'vitest';
import { fundingFloor } from '../scripts/lifecycle-mainnet.js';
import { loadConfig } from '../src/config.js';

const m = { minFundingSats: 300_000, tokenRunMinFundingSats: 40_000 };

describe('mainnet funding floor', () => {
  it('uses the token-run floor only when every wanted branch is B', () => {
    expect(fundingFloor(m, ['B'])).toBe(40_000);
    expect(fundingFloor(m, ['B', 'B'])).toBe(40_000);
    expect(fundingFloor(m, ['A', 'B'])).toBe(300_000);
    expect(fundingFloor(m, ['A', 'C', 'D', 'E'])).toBe(300_000);
    expect(fundingFloor(m, [])).toBe(300_000);
  });

  it('keeps the token-run floor below the full floor and the purchase within 2.00 PUSD', () => {
    const cfg = loadConfig().mainnet;
    expect(cfg.tokenRunMinFundingSats).toBeLessThan(cfg.minFundingSats);
    expect(cfg.tokenPurchase.maxUnits).toBeLessThanOrEqual(200);
    expect(cfg.tokenPurchase.maxSupplySats).toBeLessThan(cfg.budgetSats);
    expect(cfg.tokenPurchase.indexerUrl).toContain('{category}');
  });
});
