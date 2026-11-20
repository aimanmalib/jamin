// The public demo escrow (docs/decisions/0020-public-demo-escrow.md): its keys and amounts come from config/demo.json.
// The keys are public on purpose. They were made at random by scripts/demo-keys.ts and have no link to the project's
// test wallet; what they can spend after staging is capped at `maxSats`.
import { hash160, hexToBin, privateKeyToP2pkhCashAddress, secp256k1 } from '@bitauth/libauth';

export type DemoRole = 'seller' | 'buyer' | 'panelA' | 'panelB' | 'panelC';
export const DEMO_ROLES: readonly DemoRole[] = ['seller', 'buyer', 'panelA', 'panelB', 'panelC'];

export interface DemoConfig {
  label: string;
  /** Most satoshis the demo keys may be able to spend at any time. */
  maxSats: number;
  /** The trade amount the escrow holds for the buyer. */
  escrowSats: number;
  /** Plain coins left at the demo seller to pay the release fee, one per funder slot the SDK fills. */
  feeCoinSats: number[];
  /** Coin the buyer pays the markAsPaid fee from while staging; what is left goes back to the project wallet. */
  buyerCoinSats: number;
  /** Coin the seller deploys and funds the escrow from while staging; the change goes back. */
  sellerCoinSats: number;
  /** Private keys as hex. Public on purpose; see the label. */
  keys: Record<DemoRole, string>;
  /** The pool of demo escrows kept waiting at `paid` (decision 0021). */
  pool: PoolConfig;
}

/** The pool of demo escrows (decision 0021); checked by validPool in src/demo/pool.ts, which runs in Node only. */
export interface PoolConfig {
  /** Escrows waiting at `paid` the pool keeps, 3 to 5. */
  size: number;
  /** Most the pool may spend, net of what it takes back from the demo keys. */
  budgetSats: number;
  /** No staging at or after this time. */
  restageUntil: string;
  /** Most escrows the pool ever stages. */
  maxIndex: number;
  /** Cost of staging one escrow before any is measured: what the wallet pays out, less the change that comes back. */
  estimateSats: number;
  /** Miner fee counted for each wallet payment to a demo key (the wallet's side of a staging). */
  payFeeSats: number;
  /** Where the site reads the list of pool escrows (state/demo-public/pool.json, mounted read-only). */
  indexPath: string;
}

export interface DemoKey { privateKey: Uint8Array; publicKey: Uint8Array; pkh: Uint8Array; address: string }

export type Prefix = 'bitcoincash' | 'bchtest' | 'bchreg';

export function demoKey(hex: string, prefix: Prefix): DemoKey {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('a demo key is 32 bytes of lowercase hex');
  const privateKey = hexToBin(hex);
  if (!secp256k1.validatePrivateKey(privateKey)) throw new Error('a demo key is not a valid secp256k1 key');
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  const { address } = privateKeyToP2pkhCashAddress({ privateKey, prefix });
  return { privateKey, publicKey, pkh: hash160(publicKey), address };
}

export function demoKeys(cfg: DemoConfig, prefix: Prefix): Record<DemoRole, DemoKey> {
  const out = {} as Record<DemoRole, DemoKey>;
  for (const r of DEMO_ROLES) out[r] = demoKey(cfg.keys[r], prefix);
  return out;
}

/** FeeMath.tradeFee for a BCH escrow: basis points of the amount, raised to the dust floor. */
export function bchTradeFee(amount: bigint, feeBps: bigint): bigint {
  const fee = amount * feeBps / 10_000n;
  return fee < 546n ? 546n : fee;
}

/**
 * Satoshis the demo keys can move once the escrow is staged: the trade amount and fee in the escrow (the buyer key
 * can cancel them back to the seller key) and the seller's fee coins.
 */
export function plannedExposure(cfg: DemoConfig, feeBps: bigint): bigint {
  const amount = BigInt(cfg.escrowSats);
  return amount + bchTradeFee(amount, feeBps) + cfg.feeCoinSats.reduce((a, s) => a + BigInt(s), 0n);
}

export class ExposureError extends Error {
  constructor(readonly sats: bigint, readonly max: number) {
    super(`the demo keys could spend ${sats} sats, more than maxSats ${max}`);
    this.name = 'ExposureError';
  }
}

/** Throws when `sats` (what the demo keys can spend) passes `maxSats`. */
export function checkExposure(sats: bigint, cfg: Pick<DemoConfig, 'maxSats'>): void {
  if (sats > BigInt(cfg.maxSats)) throw new ExposureError(sats, cfg.maxSats);
}

/** Checks the shape and the cap of a demo config; staging refuses one that fails. */
export function validDemoConfig(cfg: DemoConfig, feeBps: bigint): DemoConfig {
  const ints = [cfg.maxSats, cfg.escrowSats, cfg.buyerCoinSats, cfg.sellerCoinSats, ...cfg.feeCoinSats];
  if (!ints.every((n) => Number.isInteger(n) && n > 0) || cfg.feeCoinSats.length === 0) {
    throw new Error('demo amounts must be positive whole satoshis, with at least one fee coin');
  }
  checkExposure(plannedExposure(cfg, feeBps), cfg);
  demoKeys(cfg, 'bitcoincash');
  if (new Set(DEMO_ROLES.map((r) => cfg.keys[r])).size !== DEMO_ROLES.length) throw new Error('demo keys must differ');
  return cfg;
}
