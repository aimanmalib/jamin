// Staging the public demo escrow: createEscrow, fund and markAsPaid with the demo keys, paid for by the project
// wallet, then everything the demo keys hold beyond the escrow goes back and the seller gets only its fee coins. The
// result is checked against maxSats. Node only (scripts/demo-escrow.ts); on mainnet `pay` is the gated wallet.
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
  /** Satoshis the demo keys can spend after staging, measured on the network. */
  exposure: bigint;
}

async function plainSats(provider: NetworkProvider, address: string): Promise<bigint> {
  return (await provider.getUtxos(address)).filter((u) => !u.token).reduce((a, u) => a + u.satoshis, 0n);
}

/** Sends every plain coin of `from` to `to`, minus the fee; undefined when there is nothing to send. */
async function sweep(provider: NetworkProvider, from: Signer[], to: string, feeRate: number): Promise<string | undefined> {
  const tx = new TransactionBuilder({ provider });
  let total = 0n;
  for (const s of from) {
    const coins = (await provider.getUtxos(s.address)).filter((u) => !u.token);
    if (coins.length > 0) tx.addInputs(coins, s.unlockP2PKH());
    total += coins.reduce((a, u) => a + u.satoshis, 0n);
  }
  if (total < 2_000n) return undefined;
  tx.addBchChangeOutputIfNeeded({ to, feeRate });
  return (await tx.send()).txid;
}

export async function stageDemo(provider: NetworkProvider, artifact: Artifact, cfg: DemoConfig, p: DemoParties,
  t: StageTerms, pay: Pay, returnAddress: string): Promise<Staged> {
  const amount = BigInt(cfg.escrowSats);
  const fee = bchTradeFee(amount, t.feeBps);
  const seller = new Signer(p.keys.seller.privateKey, provider);
  const buyer = new Signer(p.keys.buyer.privateKey, provider);
  const steps: StageStep[] = [];
  const extra: Staged['extra'] = [];

  const [genesis] = await pay(seller.address, [BigInt(cfg.sellerCoinSats)]);
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

  const [buyerCoin] = await pay(buyer.address, [BigInt(cfg.buyerCoinSats)]);
  if (buyerCoin) extra.push({ what: 'buyer coin', txid: buyerCoin.txid });
  steps.push({ step: 'markAsPaid', txid: (await call(buyer, p.keys.buyer.privateKey, 'markAsPaid').send()).txid });

  const back = await sweep(provider, [seller, buyer], returnAddress, t.feeRate);
  if (back) extra.push({ what: 'change back to the project wallet', txid: back });
  const feeCoins = await pay(seller.address, cfg.feeCoinSats.map(BigInt));
  if (feeCoins[0]) extra.push({ what: 'seller fee coins', txid: feeCoins[0].txid });

  let exposure = amount + fee;
  for (const k of Object.values(p.keys)) exposure += await plainSats(provider, k.address);
  checkExposure(exposure, cfg);
  return { address, steps, extra, exposure };
}
