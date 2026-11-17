import { defineConfig } from '@solidcash/solidhat/config';

// Mainnet is intentionally not configured here: mainnet transactions go only through the project
// scripts, which check the spending budget before broadcasting (docs/decisions/0001).
export default defineConfig({
  paths: {
    contracts: 'contracts',
    artifacts: 'artifacts',
    tests: 'test',
  },
  compiler: { evmCompat: true },
  typegen: {
    targets: [{ target: 'ethers6', layout: 'typechain', outDir: 'typechain-types' }],
  },
  accounts: { count: 4, satoshis: 100_000_000n },
  networks: {
    mock: { type: 'mock' },
    regtest: {
      type: 'regtest',
      rpc: {
        url: process.env.REGTEST_RPC_URL ?? 'http://127.0.0.1:18443',
        user: process.env.REGTEST_RPC_USER ?? 'user',
        password: process.env.REGTEST_RPC_PASSWORD ?? 'password',
      },
    },
  },
  defaultNetwork: 'mock',
});
