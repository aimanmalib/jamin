// Makes the public demo keys (docs/decisions/0020-public-demo-escrow.md) at random and writes them to config/demo.json.
// They are not derived from any wallet: each is 32 random bytes from the platform's secure generator. They are
// published on purpose, so the escrow they guard holds at most maxSats.
//   npx tsx scripts/demo-keys.ts            writes config/demo.json when it does not exist yet
//   npx tsx scripts/demo-keys.ts --force    replaces the keys and keeps the amounts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { binToHex, secp256k1 } from '@bitauth/libauth';
import { repoRoot } from '../src/config.js';
import { DEMO_ROLES, type DemoConfig, type DemoRole } from '../src/demo/config.js';

const FILE = `${repoRoot}config/demo.json`;

const DEFAULTS: Omit<DemoConfig, 'keys'> = {
  label: 'Public demo keys, published on purpose. They guard one mainnet escrow worth at most maxSats satoshis.',
  maxSats: 24_000, escrowSats: 5_000, feeCoinSats: [3_000, 3_000, 3_000], buyerCoinSats: 10_000, sellerCoinSats: 30_000,
};

export function randomKey(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    if (secp256k1.validatePrivateKey(bytes)) return binToHex(bytes);
  }
}

const force = process.argv.includes('--force');
if (existsSync(FILE) && !force) {
  console.error('config/demo.json exists; --force replaces its keys');
  process.exit(2);
}
const base: Omit<DemoConfig, 'keys'> = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, 'utf8')) as DemoConfig : DEFAULTS;
const keys = Object.fromEntries(DEMO_ROLES.map((r) => [r, randomKey()])) as Record<DemoRole, string>;
const out: DemoConfig = { label: base.label, maxSats: base.maxSats, escrowSats: base.escrowSats,
  feeCoinSats: base.feeCoinSats, buyerCoinSats: base.buyerCoinSats, sellerCoinSats: base.sellerCoinSats, keys };
writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote config/demo.json with ${DEMO_ROLES.length} random public demo keys`);
