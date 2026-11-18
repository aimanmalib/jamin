// Branch R: a BCH escrow where the network itself refuses two calls the contract forbids, then the valid call goes
// through (docs/decisions/0015-refused-on-the-network.md). The SDK evaluates every call before sending, so a refused
// call is built valid, taken at the provider instead of being broadcast, and then re-signed (resign.ts): the seller cancels with a locktime before the waiting time,
// and the buyer signs a release only the seller may sign. Each goes to the node or server as raw bytes; the run keeps
// its rejection text verbatim and checks that the escrow's coins are still unspent afterwards.
import {
  binToHex, decodeAuthenticationInstructions, decodeTransaction, encodeTransaction, hashTransaction, hexToBin, lockingBytecodeToCashAddress, type Output,
  type TransactionBCH,
} from '@bitauth/libauth';
import type { NetworkProvider } from '@solidcash/solidcash';
import { Status, closed, deltas, markPaid, openBch, run, stateOf } from './branches.js';
import { call, check, lockOf, type Ctx, type PartyName, type RefusedStep } from './context.js';
import { resign } from './resign.js';

const PREFIX: Record<string, 'bitcoincash' | 'bchtest' | 'bchreg'> = {
  mainnet: 'bitcoincash', chipnet: 'bchtest', regtest: 'bchreg',
};

/** Thrown when the network accepts a transaction this run expected it to refuse. */
export class AcceptedError extends Error {
  constructor(readonly step: string, readonly txid: string) {
    super(`${step}: the network accepted a transaction the contract forbids (${txid})`);
    this.name = 'AcceptedError';
  }
}

interface Program { transaction: TransactionBCH; sourceOutputs: Output[] }

/** Thrown in place of a broadcast while a call's final transaction is captured; it never reaches the network. */
export class CapturedTransaction extends Error {
  constructor(readonly hex: string) {
    super('transaction captured before broadcast');
    this.name = 'CapturedTransaction';
  }
}

const SENDS = ['sendRawTransaction', 'sendPreparedTransaction'] as const;

/** Whether every input of `hex` unlocks a plain P2PKH coin (a signature and a public key, nothing else). */
export function onlyP2pkh(hex: string): boolean {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') return false;
  return tx.inputs.every((input) => {
    const parts = decodeAuthenticationInstructions(input.unlockingBytecode);
    const [sig, key] = parts.map((p) => ('data' in p ? p.data.length : -1));
    return parts.length === 2 && sig !== undefined && sig >= 65 && sig <= 73 && key === 33;
  });
}

/**
 * The contract transaction `send` would broadcast, taken at the provider and not sent. The SDK builds, funds and
 * signs a call in `send()` only, so this is the one place its final bytes exist. Plain wallet payments the SDK sends
 * first (to make a fee coin) go through as usual.
 */
export async function capture(provider: object, send: () => Promise<unknown>): Promise<string> {
  // Only the broadcast methods this provider has: adding one would change how the SDK sends.
  const names = SENDS.filter((name) => typeof Reflect.get(provider, name) === 'function');
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(provider, name)] as const);
  const before = Object.fromEntries(names.map((name) => [name, Reflect.get(provider, name) as unknown]));
  let hex: string | undefined;
  const take = (name: string) => (arg: unknown): Promise<string> => {
    const raw = typeof arg === 'string' ? arg : (arg as { rawHex: string }).rawHex;
    const original = before[name];
    if (onlyP2pkh(raw) && typeof original === 'function') return (original as (a: unknown) => Promise<string>).call(provider, arg);
    hex = raw;
    return Promise.reject(new CapturedTransaction(raw));
  };
  for (const name of names) {
    Object.defineProperty(provider, name, { value: take(name), configurable: true, writable: true });
  }
  try {
    await send();
  } catch (e) {
    if (hex === undefined) throw e;
  } finally {
    for (const [name, d] of saved) {
      if (d) Object.defineProperty(provider, name, d);
      else Reflect.deleteProperty(provider, name);
    }
  }
  if (hex === undefined) throw new Error('the call finished without broadcasting');
  return hex;
}

/** The decoded transaction with the outputs its inputs spend, read from the network. */
export async function withSources(provider: NetworkProvider, hex: string): Promise<Program> {
  const transaction = decodeTransaction(hexToBin(hex));
  if (typeof transaction === 'string') throw new Error(transaction);
  const sourceOutputs: Output[] = [];
  for (const input of transaction.inputs) {
    const prev = decodeTransaction(hexToBin(await provider.getRawTransaction(binToHex(input.outpointTransactionHash))));
    if (typeof prev === 'string') throw new Error(prev);
    const out = prev.outputs[input.outpointIndex];
    if (!out) throw new Error('an input spends an output that does not exist');
    sourceOutputs.push(out);
  }
  return { transaction, sourceOutputs };
}

async function program(ctx: Ctx, send: () => Promise<unknown>): Promise<Program> {
  return withSources(ctx.provider, await capture(ctx.provider, send));
}

/** Whether every coin `tx` spends is still unspent at its address. */
export async function stillUnspent(ctx: Ctx, tx: TransactionBCH, sourceOutputs: Output[]): Promise<boolean> {
  const prefix = PREFIX[ctx.network] ?? 'bitcoincash';
  for (const [i, input] of tx.inputs.entries()) {
    const source = sourceOutputs[i];
    if (!source) return false;
    const addr = lockingBytecodeToCashAddress({ bytecode: source.lockingBytecode, prefix });
    if (typeof addr === 'string') throw new Error(addr);
    const txid = binToHex(input.outpointTransactionHash);
    const coins = await ctx.provider.getUtxos(addr.address);
    if (!coins.some((u) => u.txid === txid && u.vout === input.outpointIndex)) return false;
  }
  return true;
}

export interface Attempt { branch: string; step: string; by: PartyName; expected: string; afterTxid: string }

/** Sends `tx` as raw bytes, expects a refusal, and records it with the rejection text as the network gave it. */
export async function sendRefused(ctx: Ctx, a: Attempt, p: Program): Promise<RefusedStep> {
  const hex = binToHex(encodeTransaction(p.transaction));
  let serverError: string;
  try {
    const txid = await ctx.provider.sendRawTransaction(hex);
    throw new AcceptedError(a.step, txid);
  } catch (e) {
    if (e instanceof AcceptedError) throw e;
    serverError = (e as Error).message;
  }
  check(await stillUnspent(ctx, p.transaction, p.sourceOutputs), `${a.branch} ${a.step}: coins unspent after the refusal`);
  const step: RefusedStep = { branch: a.branch, step: a.step, refused: true, by: a.by, expected: a.expected,
    rawTxHash: hashTransaction(encodeTransaction(p.transaction)), serverError, at: new Date().toISOString(),
    afterTxid: a.afterTxid };
  ctx.refused.push(step);
  return step;
}

export async function branchR(ctx: Ctx): Promise<void> {
  const { seller, buyer } = ctx.parties;
  const { sc, fee, txid: funded } = await openBch(ctx, 'R');
  const after = (await stateOf(sc)).terms.sellerCanCancelAfter;

  // The seller cancels before the waiting time. Built with the locktime the contract asks for (the SDK would refuse
  // to build anything else), then moved one second behind the chain's median time past and signed again.
  const early = await ctx.provider.getMedianTimePast() - 1;
  check(BigInt(early) < after, 'R: the waiting time has not passed');
  const cancel = await program(ctx, () => call(sc, seller, 'sellerCancel').setLocktime(Number(after))
    .transfer(lockOf(seller.address), ctx.terms.amount + fee).send());
  const tooEarly = resign(cancel.transaction, cancel.sourceOutputs, seller.publicKey, seller.signer.privateKey,
    { inputs: 'all', mutate: (tx) => ({ ...tx, locktime: early }) });
  await sendRefused(ctx, { branch: 'R', step: 'sellerCancel', by: 'seller', expected: 'TooEarly', afterTxid: funded },
    { transaction: tooEarly.transaction, sourceOutputs: cancel.sourceOutputs });

  const paid = await markPaid(ctx, 'R', sc);

  // The buyer signs the release in place of the seller; the seller's fee input stays as it was.
  const release = await program(ctx, () => call(sc, seller, 'release').send());
  const byBuyer = resign(release.transaction, release.sourceOutputs, seller.publicKey, buyer.signer.privateKey,
    { inputs: 'p2sh' });
  await sendRefused(ctx, { branch: 'R', step: 'release', by: 'buyer', expected: 'NotSeller', afterTxid: paid },
    { transaction: byBuyer.transaction, sourceOutputs: release.sourceOutputs });

  const [buyerGot, feesGot] = await deltas(ctx, ['buyer', 'fees'], () =>
    run(ctx, 'R', 'release', call(sc, seller, 'release').send()));
  check(buyerGot === ctx.terms.amount && feesGot === fee, 'R: buyer receives the amount and the fee recipient the fee');
  await closed(ctx, sc, Status.Released, 'R');
}
