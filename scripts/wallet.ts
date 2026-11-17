// Test wallet tool. Prints public addresses, balances and txids only; never the phrase or a private key.
//   npm run wallet -- init      create .env with a new phrase (0600) when none exists
//   npm run wallet -- address   print the receive address (and role addresses) with the balance
import { join } from 'node:path';
import { loadConfig, repoRoot, type Role } from '../src/config.js';
import { childPath, deriveKey, newMnemonic } from '../src/wallet/keys.js';
import { readEnvValue, writeEnvValueOnce } from '../src/wallet/env-file.js';
import { fetchBalance } from '../src/wallet/electrum.js';

const config = loadConfig();
const envFile = join(repoRoot, config.wallet.envFile);
const key = config.wallet.mnemonicEnv;

function mnemonic(): string {
  const value = process.env[key] ?? readEnvValue(envFile, key);
  if (!value) throw new Error(`${key} is not set; run: npm run wallet -- init`);
  return value;
}

async function main(command: string | undefined): Promise<void> {
  if (command === 'init') {
    if (readEnvValue(envFile, key) !== undefined) {
      console.log(`${key} already exists in ${config.wallet.envFile}; nothing to do.`);
      return;
    }
    writeEnvValueOnce(envFile, key, newMnemonic());
    console.log(`Created ${config.wallet.envFile} with a new ${key} (mode 0600).`);
    return;
  }
  if (command === 'address') {
    const phrase = mnemonic();
    const base = config.wallet.derivationBase;
    const receive = deriveKey(phrase, childPath(base, config.wallet.receiveIndex));
    console.log(`receive ${receive.path} ${receive.address}`);
    console.log(`receive-tokens ${receive.path} ${receive.tokenAddress}`);
    for (const [role, index] of Object.entries(config.wallet.roles) as [Role, number][]) {
      console.log(`${role} ${childPath(base, index)} ${deriveKey(phrase, childPath(base, index)).address}`);
    }
    if (process.argv.includes('--offline')) return;
    const balance = await fetchBalance(config.electrum.mainnet, receive.address);
    console.log(`balance confirmed=${balance.confirmed} unconfirmed=${balance.unconfirmed} sat (${config.electrum.mainnet.hostname})`);
    return;
  }
  throw new Error('usage: npm run wallet -- init | address [--offline]');
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
