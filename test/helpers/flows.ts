// Escrows brought to a given status, shared by the BCH and CashToken test files.
import type { Utxo } from '@solidcash/solidcash';
import { TERMS, deploy, entry, panelSigs, world, roleParams, type World } from './escrow.js';

type Escrow = Awaited<ReturnType<typeof deploy>>['sc'];

/** The BCH escrow fee: 30 bps of 200,000 sats. */
export const BCH_FEE = 600n;

/** The token escrow amount (2.00 of a two-decimal token), its fee (0.6 units raised to the one-unit floor) and the
 * unit that stays in the token container. */
export const TOKEN = { amount: 200n, fee: 1n, reserve: 1n } as const;

export interface TokenWorld extends World { category: string; sellerCoin: Utxo }

/** Deploys a BCH escrow and funds it with amount + fee. */
export async function openBch(w: World): Promise<Escrow> {
  const { seller } = w.roles;
  const d = await deploy(w, 'JaminEscrow', roleParams(w.roles),
    [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
  await entry(d.sc.connect(seller), 'fund', w.sig(seller)).withValue(TERMS.amount + BCH_FEE).send();
  return d.sc;
}

export async function paidBch(w: World): Promise<Escrow> {
  const { buyer } = w.roles;
  const sc = await openBch(w);
  await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
  return sc;
}

/** Paid, then the buyer opens a dispute and pays the dispute fee. */
export async function disputedBch(w: World): Promise<Escrow> {
  const { buyer } = w.roles;
  const sc = await paidBch(w);
  await entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
  return sc;
}

/** A mock world where the seller also holds amount + fee + reserve units of a fresh test token. */
export async function tokenWorld(): Promise<TokenWorld> {
  const w = await world();
  const { categoryId, utxos } = await w.provider.addTokenUtxos([
    { address: w.roles.seller.address, satoshis: 1_000n, token: { amount: TOKEN.amount + TOKEN.fee + TOKEN.reserve } },
  ]);
  const sellerCoin = utxos[0];
  if (!sellerCoin) throw new Error('token coin missing');
  return { ...w, category: categoryId, sellerCoin };
}

/** Deploys a token escrow and moves amount + fee + the reserve unit into its token container. */
export async function openToken(w: TokenWorld): Promise<Escrow> {
  const { seller } = w.roles;
  const d = await deploy(w, 'JaminTokenEscrow', [...roleParams(w.roles), w.category],
    [TOKEN.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
  await entry(d.sc.connect(seller), 'deposit', w.sig(seller), w.category).addInput(w.sellerCoin, seller.unlockP2PKH())
    .tokenContainerDeposit(w.category, TOKEN.amount + TOKEN.fee + TOKEN.reserve).send();
  return d.sc;
}

export async function paidToken(w: TokenWorld): Promise<Escrow> {
  const { buyer } = w.roles;
  const sc = await openToken(w);
  await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer), w.category).send();
  return sc;
}

export async function disputedToken(w: TokenWorld): Promise<Escrow> {
  const { buyer } = w.roles;
  const sc = await paidToken(w);
  await entry(sc.connect(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send();
  return sc;
}

/** Moves the mock clock past the seller's waiting time. */
export async function waitOut(w: World): Promise<void> {
  w.provider.increaseTime(TERMS.waitSeconds + 60n);
  await w.provider.mine(1);
}

/**
 * The call builder of `name` with locktime `lockTime` set, so the SDK takes the payments named with `.transfer()` /
 * `.tokenContainerTransfer()` instead of deriving them (docs/SOLIDCASH-FINDINGS.md, F6). Tests use it to put
 * outputs other than the contract's in front of the contract. `lockTime` comes from `lockTimeNow(w)`.
 */
export function byHand(w: World, sc: Escrow, signer: keyof World['roles'], lockTime: number, name: string,
  ...args: unknown[]): ReturnType<typeof entry> {
  const s = w.roles[signer];
  return entry(sc.connect(s), name, w.sig(s), ...args).setLocktime(lockTime);
}

/** `resolveDispute` signed by panel members A and B, set up like `byHand` (the arbitrator pays the fee). */
export function byPanel(w: World, sc: Escrow, lockTime: number, ...args: unknown[]): ReturnType<typeof entry> {
  return entry(sc.connect(w.roles.arbitrator), 'resolveDispute', ...panelSigs(w), ...args).setLocktime(lockTime);
}
