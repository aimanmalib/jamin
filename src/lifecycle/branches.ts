// The five lifecycle branches of an escrow, as transactions on a real network: A release (BCH), B release
// (CashToken), C buyer cancel, D seller cancel after the waiting time, E dispute and resolution. Each branch checks
// what the recipients received and that the escrow keeps only its reserve, and records every transaction id.
import { StatefulContract } from '@solidcash/solidcash/stateful';
import type { TransactionDetails } from '@solidcash/solidcash';
import { PANEL, call, check, loadArtifact, panelCall, lockOf, satsAt, tokensAt, type Ctx, type PartyName } from './context.js';

type Escrow = StatefulContract;

/** EscrowBase.Status, in declaration order. */
export const Status = { Funded: 1n, Paid: 2n, Disputed: 3n, Released: 4n, CancelledByBuyer: 5n,
  CancelledBySeller: 6n, Resolved: 7n } as const;

interface State { status: bigint; terms: { amount: bigint; fee: bigint; disputeFee: bigint; sellerCanCancelAfter: bigint } }

export async function stateOf(sc: Escrow): Promise<State> {
  const s = await sc.getState() as { status: bigint | number; terms: State['terms'] };
  return { status: BigInt(s.status), terms: s.terms };
}

export async function run(ctx: Ctx, branch: string, step: string, send: Promise<TransactionDetails>): Promise<string> {
  const { txid } = await send;
  ctx.record({ branch, step, txid });
  return txid;
}

/** Contract parameters of an escrow between the context's parties. */
function escrowParams(ctx: Ctx, extra: unknown[]): unknown[] {
  const { seller, buyer, fees } = ctx.parties;
  return [seller.publicKey, buyer.publicKey, ...PANEL.map((n) => ctx.parties[n].publicKey), fees.signer.pkh, ...extra];
}

async function deploy(ctx: Ctx, branch: string, name: string, extra: unknown[], amount: bigint): Promise<Escrow> {
  const { seller } = ctx.parties;
  const now = BigInt(await ctx.provider.getMedianTimePast());
  const params = escrowParams(ctx, extra);
  const { contract, tx } = await StatefulContract.deploy(loadArtifact(name), params as never, {
    provider: ctx.provider, fundingUtxo: await ctx.genesisCoin('seller'), funder: seller.signer.unlockP2PKH(),
    changeAddress: seller.address, initialBalance: ctx.terms.reserve,
    initArgs: [amount, ctx.terms.feeBps, ctx.terms.disputeFee, now + ctx.terms.waitSeconds] as never,
  });
  ctx.record({ branch, step: 'createEscrow', txid: tx.txid, escrow: await contract.getAddress() });
  return contract;
}

export async function openBch(ctx: Ctx, branch: string): Promise<{ sc: Escrow; fee: bigint; txid: string }> {
  const sc = await deploy(ctx, branch, 'JaminEscrow', [], ctx.terms.amount);
  const { fee } = (await stateOf(sc)).terms;
  const txid = await run(ctx, branch, 'fund', call(sc, ctx.parties.seller, 'fund').withValue(ctx.terms.amount + fee).send());
  return { sc, fee, txid };
}

export async function markPaid(ctx: Ctx, branch: string, sc: Escrow, ...args: unknown[]): Promise<string> {
  return run(ctx, branch, 'markAsPaid', call(sc, ctx.parties.buyer, 'markAsPaid', ...args).send());
}

/** Satoshi changes at the named parties' addresses while `body` runs. */
export async function deltas(ctx: Ctx, names: PartyName[], body: () => Promise<unknown>): Promise<bigint[]> {
  const read = (): Promise<bigint[]> => Promise.all(names.map((n) => satsAt(ctx.provider, ctx.parties[n].address)));
  const before = await read();
  await body();
  const after = await read();
  return after.map((a, i) => a - (before[i] ?? 0n));
}

export async function closed(ctx: Ctx, sc: Escrow, status: bigint, label: string): Promise<void> {
  check((await stateOf(sc)).status === status, `${label}: status ${status}`);
  check(await sc.getBalance() === ctx.terms.reserve, `${label}: escrow keeps only the reserve`);
}

export async function branchA(ctx: Ctx): Promise<void> {
  const { sc, fee } = await openBch(ctx, 'A');
  await markPaid(ctx, 'A', sc);
  const [buyer, fees] = await deltas(ctx, ['buyer', 'fees'], () =>
    run(ctx, 'A', 'release', call(sc, ctx.parties.seller, 'release').send()));
  check(buyer === ctx.terms.amount && fees === fee, 'A: buyer receives the amount and the fee recipient the fee');
  await closed(ctx, sc, Status.Released, 'A');
}

/** FeeMath.tradeFee: basis points of the amount, raised to `floor`. */
export function tradeFee(amount: bigint, feeBps: bigint, floor: bigint): bigint {
  const fee = amount * feeBps / 10_000n;
  return fee < floor ? floor : fee;
}

/** A token escrow created and holding amount + fee + one reserve unit: branch B releases it, branch T cancels it. */
export async function openToken(ctx: Ctx, branch: string): Promise<{ sc: Escrow; category: string; fee: bigint }> {
  const amount = ctx.terms.tokenAmount;
  const fee = tradeFee(amount, ctx.terms.feeBps, 1n);
  // amount + fee go out on release; one unit stays in the token container, as the reserve satoshis do.
  const total = amount + fee + 1n;
  // The token escrow binds its category as a constructor parameter, so the token exists before the deployment.
  const { category, coin } = await ctx.tokenCoin(total);
  const sc = await deploy(ctx, branch, 'JaminTokenEscrow', [category], amount);
  check((await stateOf(sc)).terms.fee === fee, `${branch}: the contract computes the same token fee`);
  const { seller } = ctx.parties;
  await run(ctx, branch, 'deposit', call(sc, seller, 'deposit', category)
    .addInput(coin, seller.signer.unlockP2PKH()).tokenContainerDeposit(category, total).send());
  return { sc, category, fee };
}

export async function branchB(ctx: Ctx): Promise<void> {
  const amount = ctx.terms.tokenAmount;
  const { seller, buyer, fees } = ctx.parties;
  const read = (address: string, category: string): Promise<bigint> => tokensAt(ctx.provider, address, category);
  const { sc, category, fee } = await openToken(ctx, 'B');
  const before = [await read(buyer.address, category), await read(fees.address, category)];
  await markPaid(ctx, 'B', sc, category);
  await run(ctx, 'B', 'release', call(sc, seller, 'release', category).send());
  check(await read(buyer.address, category) - (before[0] ?? 0n) === amount,
    'B: the buyer receives the token amount');
  check(await read(fees.address, category) - (before[1] ?? 0n) === fee,
    'B: the fee recipient receives the token fee');
  check(await tokensAt(ctx.provider, sc.getTokenContainerAddress(category), category) === 1n,
    'B: the token container keeps the reserve unit');
  check((await stateOf(sc)).status === Status.Released, 'B: released');
}

export async function branchC(ctx: Ctx): Promise<void> {
  const { sc, fee } = await openBch(ctx, 'C');
  await markPaid(ctx, 'C', sc);
  const [seller, fees] = await deltas(ctx, ['seller', 'fees'], () =>
    run(ctx, 'C', 'buyerCancel', call(sc, ctx.parties.buyer, 'buyerCancel').send()));
  check(seller === ctx.terms.amount + fee && fees === 0n, 'C: the seller gets amount and fee back');
  await closed(ctx, sc, Status.CancelledByBuyer, 'C');
}

/** Opens a D escrow and returns it with the time the seller may cancel; `finishD` cancels it. */
export async function startD(ctx: Ctx): Promise<{ sc: Escrow; fee: bigint; after: bigint }> {
  const { sc, fee } = await openBch(ctx, 'D');
  return { sc, fee, after: (await stateOf(sc)).terms.sellerCanCancelAfter };
}

/** What a later run needs to finish a D escrow: where it is and its terms. */
export interface PendingD { address: string; fee: bigint; after: bigint }

export async function pendingD(d: { sc: Escrow; fee: bigint; after: bigint }): Promise<PendingD> {
  return { address: await d.sc.getAddress(), fee: d.fee, after: d.after };
}

/** The D escrow a previous run opened, attached again from its address. */
export async function resumeD(ctx: Ctx, p: PendingD): Promise<{ sc: Escrow; fee: bigint; after: bigint }> {
  const sc = await StatefulContract.at(p.address, loadArtifact('JaminEscrow'), ctx.provider,
    { constructorArgs: escrowParams(ctx, []) as never });
  return { sc: sc as unknown as Escrow, fee: p.fee, after: p.after };
}

export async function finishD(ctx: Ctx, d: { sc: Escrow; fee: bigint; after: bigint }): Promise<void> {
  await ctx.waitUntil(d.after);
  const { seller } = ctx.parties;
  // A time-type locktime one second behind the median time past; with a locktime set the payment is named by hand
  // (docs/SOLIDCASH-FINDINGS.md, F6).
  const lockTime = await ctx.provider.getMedianTimePast() - 1;
  check(BigInt(lockTime) >= d.after, 'D: the waiting time has passed');
  await run(ctx, 'D', 'sellerCancel', call(d.sc, seller, 'sellerCancel').setLocktime(lockTime)
    .transfer(lockOf(seller.address), ctx.terms.amount + d.fee).send());
  await closed(ctx, d.sc, Status.CancelledBySeller, 'D');
}

export async function branchE(ctx: Ctx): Promise<void> {
  const { sc, fee } = await openBch(ctx, 'E');
  await markPaid(ctx, 'E', sc);
  await run(ctx, 'E', 'openDispute', call(sc, ctx.parties.buyer, 'openDispute', true)
    .withValue(ctx.terms.disputeFee).send());
  const [buyer, fees] = await deltas(ctx, ['buyer', 'fees'], () =>
    run(ctx, 'E', 'resolveDispute', panelCall(sc, ctx.parties, ['arbitrator', 'arbiterB'], true).send()));
  check(buyer === ctx.terms.amount + ctx.terms.disputeFee && fees === fee,
    'E: the buyer wins the amount and the dispute fee, the fee recipient the fee');
  await closed(ctx, sc, Status.Resolved, 'E');
}
