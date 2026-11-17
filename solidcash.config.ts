import { defineConfig } from '@solidcash/solidhat/config';

// Mainnet is intentionally not configured here: mainnet transactions go only through the project
// scripts, which check the spending budget before broadcasting (docs/decisions/0001).
export default defineConfig({
  paths: {
    contracts: 'contracts',
    artifacts: 'artifacts',
    tests: 'test',
  },
  // Native SolidCash ABI and selectors: smaller scripts than evmCompat (docs/decisions/0002).
  compiler: { evmCompat: false },
  typegen: {
    targets: [{ target: 'ethers6', layout: 'typechain', outDir: 'typechain-types' }],
  },
  accounts: { count: 4, satoshis: 100_000_000n },
  networks: {
    // Real BCH limits (10,000 byte inputs, 128 byte commitments, dust), so compiled artifacts and tests do not
    // depend on the relaxed mock defaults.
    mock: {
      type: 'mock',
      policy: { enforceDust: true },
      consensus: {
        maximumInputBytes: 10_000,
        maximumStackItemBytes: 10_000,
        maximumTransactionBytes: 100_000,
        maximumNftCommitmentBytes: 128,
      },
    },
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
