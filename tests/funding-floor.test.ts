// The funding floor of a mainnet run: branches B and R need only their fees, reserves and one escrow (decisions 0012,
// 0016); any run with another BCH branch keeps the full floor (decision 0011).
import { describe, expect, it } from 'vitest';
import { fundingFloor } from '../scripts/lifecycle-mainnet.js';
import { loadConfig } from '../src/config.js';

const m = { minFundingSats: 300_000, branchFloorSats: { B: 40_000, R: 60_000 } };

describe('mainnet funding floor', () => {
  it('uses a branch floor only when every wanted branch has one, and the highest of them', () => {
    expect(fundingFloor(m, ['B'])).toBe(40_000);
    expect(fundingFloor(m, ['B', 'B'])).toBe(40_000);
    expect(fundingFloor(m, ['R'])).toBe(60_000);
    expect(fundingFloor(m, ['B', 'R'])).toBe(60_000);
    expect(fundingFloor(m, ['A', 'B'])).toBe(300_000);
    expect(fundingFloor(m, ['R', 'C'])).toBe(300_000);
    expect(fundingFloor(m, ['A', 'C', 'D', 'E'])).toBe(300_000);
    expect(fundingFloor(m, [])).toBe(300_000);
  });

  it('covers the branch R genesis coin and keeps every branch floor below the full floor', () => {
    const cfg = loadConfig().mainnet;
    for (const f of Object.values(cfg.branchFloorSats)) expect(f).toBeLessThan(cfg.minFundingSats);
    // Branch R pays its genesis coin first, then the escrow amount and reserve (src/lifecycle/mainnet.ts).
    expect(cfg.branchFloorSats.R).toBeGreaterThan(cfg.genesisCoinSats + 3_000);
    expect(cfg.tokenPurchase.maxUnits).toBeLessThanOrEqual(200);
    expect(cfg.tokenPurchase.maxSupplySats).toBeLessThan(cfg.budgetSats);
    expect(cfg.tokenPurchase.indexerUrl).toContain('{category}');
  });
});
