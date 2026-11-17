import { defineConfig } from 'vitest/config';
import { solidhatPreset } from '@solidcash/solidhat/vitest-preset';

export default defineConfig(solidhatPreset({"hardhat":3,"ethers":6}, {
  // Contract calls on the production-profile mock take seconds each.
  test: { include: ['test/**/*.test.{ts,js}'], testTimeout: 120_000 },
}));
