// Staging the public demo escrow: createEscrow, fund and markAsPaid with the demo keys, paid for by the project
// wallet, then everything the demo keys hold beyond the escrow goes back and the seller gets only its fee coins. The
// result is checked against maxSats. Node only (scripts/demo-escrow.ts, scripts/demo-restage.ts); on mainnet `pay` is
// the gated wallet. Coins the demo keys held before this staging (fee coins of other escrows in the pool, decision
// 0021) are left alone: the sweep back takes only coins this staging made, and maxSats bounds what it added.
import { cashAddressToLockingBytecode, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { Signer, SignatureTemplate, TransactionBuilder, type Artifact, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { bchTradeFee, checkExposure, type DemoConfig } from './config.js';
import { demoParams, type DemoParties } from './escrow.js';

export interface StageTerms { feeBps: bigint; disputeFee: bigint; waitSeconds: bigint; reserve: bigint; feeRate: number }

/** Pays `amounts` to `address` as outputs 0, 1, ... and returns those coins. */
export type Pay = (address: string, amounts: bigint[]) => Promise<Utxo[]>;

export interface StageStep { step: 'createEscrow' | 'fund' | 'markAsPaid'; txid: string; escrow?: string }

export interface Staged {
  address: string;
  steps: StageStep[];
  /** Transactions around the escrow: the coins paid in, the sweep back, the fee coins. */
  extra: { what: string; txid: string }[];
  /** Satoshis this staging let the demo keys spend, measured on the network: the escrow plus the coins it added. */
  exposure: bigint;
  /** Satoshis paid to the demo keys, and what came back to `returnAddress` in the sweep. */
  paidSats: bigint;
  returnedSats: bigint;
  /** Payments made through `pay`: each is one wallet transaction with its own miner fee. */
  payments: number;
}

/** Indexes of the `n` largest coins: the fee coins kept at the demo seller for the escrows still waiting. */
export function largest(sats: bigint[], n: number): Set<number> {
  return new Set(sats.map((s, i) => [s, i] as const).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, Math.max(0, n)).map(([, i]) => i));
}

const outpoint = (u: Utxo): string => `${u.txid}:${u.vout}`;

async function plainCoins(provider: NetworkProvider, address: string): Promise<Utxo[]> {
  return (await provider.getUtxos(address)).filter((u) => !u.token);
}

async function plainSats(provider: NetworkProvider, addresses: string[]): Promise<bigint> {
  let total = 0n;
  for (const a of addresses) total += (await plainCoins(provider, a)).reduce((s, u) => s + u.satoshis, 0n);
  return total;
}

/** Satoshis `hex` pays to `address`, read from the decoded outputs. */
function paidTo(hex: string, address: string): bigint {
  const tx = decodeTransaction(hexToBin(hex));
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof tx === 'string' || typeof decoded === 'string') return 0n;
  const lock = decoded.bytecode;
  const want = lock.join(',');
  return tx.outputs.filter((o) => o.lockingBytecode.join(',') === want).reduce((a, o) => a + o.valueSatoshis, 0n);
}

/**
 * Sends the plain coins of `from` that are not in `keep` to `to`, minus the fee; undefined when there is too little.
 */
export async function sweep(provider: NetworkProvider, from: Signer[], keep: Set<string>, to: string,
  feeRate: number): Promise<{ txid: string; sats: bigint } | undefined> {
  const tx = new TransactionBuilder({ provider });
  let total = 0n;
  for (const s of from) {
    const coins = (await plainCoins(provider, s.address)).filter((u) => !keep.has(outpoint(u)));
    if (coins.length > 0) tx.addInputs(coins, s.unlockP2PKH());
    total += coins.reduce((a, u) => a + u.satoshis, 0n);
  }
  if (total < 2_000n) return undefined;
  tx.addBchChangeOutputIfNeeded({ to, feeRate });
  const { txid, hex } = await tx.send();
  return { txid, sats: paidTo(hex, to) };
}

export async function stageDemo(provider: NetworkProvider, artifact: Artifact, cfg: DemoConfig, p: DemoParties,
  t: StageTerms, pay: Pay, returnAddress: string): Promise<Staged> {
  const amount = BigInt(cfg.escrowSats);
  const fee = bchTradeFee(amount, t.feeBps);
  const seller = new Signer(p.keys.seller.privateKey, provider);
  const buyer = new Signer(p.keys.buyer.privateKey, provider);
  const steps: StageStep[] = [];
  const extra: Staged['extra'] = [];
  const demoAddresses = Object.values(p.keys).map((k) => k.address);
  const before = await plainSats(provider, demoAddresses);
  const held = new Set<string>();
  for (const s of [seller, buyer]) for (const u of await plainCoins(provider, s.address)) held.add(outpoint(u));
  let paidSats = 0n;
  let payments = 0;
  const payCounted: Pay = async (address, amounts) => {
    payments += 1;
    paidSats += amounts.reduce((a, x) => a + x, 0n);
    return pay(address, amounts);
  };

  const [genesis] = await payCounted(seller.address, [BigInt(cfg.sellerCoinSats)]);
  if (!genesis || genesis.vout !== 0) throw new Error('the seller coin must be output 0, a deployment spends it as genesis');
  extra.push({ what: 'seller coin', txid: genesis.txid });
  const now = BigInt(await provider.getMedianTimePast());
  const { contract, tx } = await StatefulContract.deploy(artifact, demoParams(p) as never, {
    provider, fundingUtxo: genesis, funder: seller.unlockP2PKH(), changeAddress: seller.address,
    initialBalance: t.reserve, initArgs: [amount, t.feeBps, t.disputeFee, now + t.waitSeconds] as never,
  });
  const address = await contract.getAddress();
  steps.push({ step: 'createEscrow', txid: tx.txid, escrow: address });
  const call = (who: Signer, key: Uint8Array, name: string) => {
    const fn = contract.connect(who).call[name];
    if (fn === undefined) throw new Error(`contract has no entry point ${name}`);
    return fn(new SignatureTemplate(key) as never);
  };
  steps.push({ step: 'fund', txid: (await call(seller, p.keys.seller.privateKey, 'fund').withValue(amount + fee).send()).txid });

  const [buyerCoin] = await payCounted(buyer.address, [BigInt(cfg.buyerCoinSats)]);
  if (buyerCoin) extra.push({ what: 'buyer coin', txid: buyerCoin.txid });
  steps.push({ step: 'markAsPaid', txid: (await call(buyer, p.keys.buyer.privateKey, 'markAsPaid').send()).txid });

  const back = await sweep(provider, [seller, buyer], held, returnAddress, t.feeRate);
  if (back) extra.push({ what: 'change back to the project wallet', txid: back.txid });
  const feeCoins = await payCounted(seller.address, cfg.feeCoinSats.map(BigInt));
  if (feeCoins[0]) extra.push({ what: 'seller fee coins', txid: feeCoins[0].txid });

  const exposure = amount + fee + await plainSats(provider, demoAddresses) - before;
  checkExposure(exposure, cfg);
  return { address, steps, extra, exposure, paidSats, returnedSats: back?.sats ?? 0n, payments };
}

/**
 * The pool's sweep (decision 0021): every plain coin the demo keys hold goes back to `to`, except the `keepSellerCoins`
 * largest coins at the demo seller, which pay the release fee of the escrows still waiting.
 */
export async function sweepDemoKeys(provider: NetworkProvider, p: DemoParties, keepSellerCoins: number, to: string,
  feeRate: number): Promise<{ txid: string; sats: bigint } | undefined> {
  const signers = Object.values(p.keys).map((k) => new Signer(k.privateKey, provider));
  const sellerCoins = await plainCoins(provider, p.keys.seller.address);
  const kept = largest(sellerCoins.map((u) => u.satoshis), keepSellerCoins);
  const keep = new Set(sellerCoins.filter((_, i) => kept.has(i)).map(outpoint));
  return sweep(provider, signers, keep, to, feeRate);
}
