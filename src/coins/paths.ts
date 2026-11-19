// Is there a way to spend the coins a finished escrow leaves behind? Every entry point of the deployed contract is
// called as its rightful party would call it on a mirror: a mock network holding exact copies of the contract's
// coins, so the SDK's own evaluation answers the question and nothing reaches the network. Event coins are swept with the event covenant's own unlocker; they need a relative lock (OP_CHECKSEQUENCEVERIFY).
import { binToHex, cashAddressToLockingBytecode, sha256, utf8ToBin } from '@bitauth/libauth';
import { TransactionBuilder, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { publishMetadata, type IdentityRecord } from '@solidcash/solidcash/bcmr';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { createEventNftUnlocker, type StatefulContract } from '@solidcash/solidcash/stateful';
import { fillerUnlocker } from './filler.js';
import { call, panelCall, type Party, type PartyName } from '../lifecycle/context.js';

export interface MirrorCoin { address: string; utxo: Utxo }

/**
 * A mock network holding exact copies of a contract's coins as the chain lists them, plus funding coins for each
 * party, at the chain's time; `chain` serves the transactions the mirror lacks. A call the contract allows is accepted here as it would be on the chain; nothing here
 * reaches the network. The funding coins are made up and only pay fees: they do not change what the contract allows.
 */
export async function mirror(coins: readonly MirrorCoin[], payers: readonly string[], medianTimePast: number,
  fundingSats: bigint, chain?: Pick<NetworkProvider, 'getRawTransaction'>): Promise<NetworkProvider> {
  const mock = new MockNetworkProvider();
  for (const c of coins) await mock.addUtxo(c.address, c.utxo);
  for (const [i, address] of payers.entries()) {
    for (let n = 0; n < 6; n++) {
      const txid = binToHex(sha256.hash(utf8ToBin(`mirror funding ${i} ${n}`)));
      await mock.addUtxo(address, { txid, vout: 0, satoshis: fundingSats });
    }
  }
  mock.increaseTime(medianTimePast - mock.getBlockTime());
  if (!chain) return mock as unknown as NetworkProvider;
  // Transactions the mirror did not make (the genesis an identity spend reads) come from the chain, read only.
  return new Proxy(mock, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (prop !== 'getRawTransaction' || typeof value !== 'function') return value;
      return async (txid: string): Promise<string> => {
        try {
          return await (value as (id: string) => Promise<string>).call(target, txid);
        } catch {
          return chain.getRawTransaction(txid);
        }
      };
    },
  }) as unknown as NetworkProvider;
}

/** An error's text on one line, without any URL, so a debugging link never reaches a report. */
export function verbatim(e: unknown): string {
  const text = e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e);
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).join(' ')
    .replace(/\bhttps?:\/\/\S+/g, '<url>').slice(0, 300);
}

export interface PathResult {
  path: string;
  /** Who signed, as the role names the contract checks. */
  signer: string;
  /** 'refused': the call failed on the mirror; 'accepted': the mirror took it, so the chain would too. */
  outcome: 'refused' | 'accepted';
  error?: string;
}

async function attempt(path: string, signer: string, send: () => Promise<unknown>): Promise<PathResult> {
  try {
    await send();
    return { path, signer, outcome: 'accepted' };
  } catch (e) {
    return { path, signer, outcome: 'refused', error: verbatim(e) };
  }
}

export interface CallTerms { amount: bigint; fee: bigint; disputeFee: bigint }

/**
 * Every entry point of a finished escrow, called by the party that may call it. `sc` and the parties must sit on a
 * mirror. `category` is the token escrow's token; absent for the BCH escrow.
 */
export async function tryEntryPoints(sc: StatefulContract, parties: Record<PartyName, Party>, terms: CallTerms,
  category?: string): Promise<PathResult[]> {
  const { seller, buyer } = parties;
  const tok = category === undefined ? [] : [category];
  const tries: [string, string, () => Promise<unknown>][] = [
    category === undefined
      ? ['fund', 'seller', () => call(sc, seller, 'fund').withValue(terms.amount + terms.fee).send()]
      : ['deposit', 'seller', () => call(sc, seller, 'deposit', ...tok).send()],
    ['markAsPaid', 'buyer', () => call(sc, buyer, 'markAsPaid', ...tok).send()],
    ['release', 'seller', () => call(sc, seller, 'release', ...tok).send()],
    ['buyerCancel', 'buyer', () => call(sc, buyer, 'buyerCancel', ...tok).send()],
    ['sellerCancel', 'seller', () => call(sc, seller, 'sellerCancel', ...tok).send()],
    ['openDispute', 'buyer', () => call(sc, buyer, 'openDispute', true).withValue(terms.disputeFee).send()],
    ['resolveDispute', 'panel A+B', () => panelCall(sc, parties, ['arbitrator', 'arbiterB'], ...tok, true).send()],
  ];
  const results: PathResult[] = [];
  for (const [path, signer, send] of tries) results.push(await attempt(path, signer, send));
  return results;
}

/** An event record of the contract, or a filler (src/coins/filler.ts) when `event` is left out. */
export interface EventCoin { utxo: Utxo; event?: string }

/**
 * A transaction that spends `coins` (event records of `sc`, and fillers) to `to`, paying `feeRate` sat/byte. Event
 * records carry a non-fungible token of the contract's category with no capability; the sweep burns it on purpose.
 * Both covenants check a block-based relative lock, which the input's sequence number carries.
 */
export function eventSweep(sc: StatefulContract, provider: NetworkProvider, coins: readonly EventCoin[], to: string,
  feeRate: number, relativeBlocks: number): TransactionBuilder {
  const build = (fee: bigint): TransactionBuilder => {
    const tx = new TransactionBuilder({ provider, allowImplicitNftBurn: true });
    for (const c of coins) {
      const unlocker = c.event === undefined ? fillerUnlocker() : createEventNftUnlocker(sc.inner, sc.categoryId, c.event);
      tx.addInput(c.utxo, unlocker, { sequence: relativeBlocks });
    }
    const total = coins.reduce((a, c) => a + c.utxo.satoshis, 0n);
    return tx.addOutput({ to, amount: total - fee });
  };
  const size = build(1_000n).build().length / 2;
  return build(BigInt(Math.ceil(size * feeRate)));
}

export function lockHex(address: string): string {
  const lock = cashAddressToLockingBytecode(address);
  if (typeof lock === 'string') throw new Error(lock);
  return binToHex(lock.bytecode);
}

/**
 * A plain coin of `owner` that can pay an identity spend's fee: the smallest one holding at least `minSats`, coins at
 * output 0 last (the SDK refuses an owner coin at output 0 that could itself be another identity).
 */
export async function feeCoin(provider: NetworkProvider, owner: string, minSats: bigint): Promise<Utxo | undefined> {
  return (await provider.getUtxos(owner)).filter((u) => !u.token && u.satoshis >= minSats)
    .sort((a, b) => Number(a.vout === 0) - Number(b.vout === 0)
      || (a.satoshis < b.satoshis ? -1 : a.satoshis > b.satoshis ? 1 : 0))[0];
}

/**
 * Burns the category's identity (its metadata authhead) as its owner: output 0 becomes OP_RETURN and the authhead's
 * satoshis return to `owner` as change, less the fee. Ends the identity; the escrow's own coins are not touched.
 */
export async function burnIdentity(provider: NetworkProvider, identity: IdentityRecord, owner: Party,
  minFeeCoinSats: bigint): Promise<string> {
  const utxo = await feeCoin(provider, owner.address, minFeeCoinSats);
  if (!utxo) throw new Error(`${owner.address} has no plain coin of ${minFeeCoinSats} sat or more for the fee`);
  const r = await publishMetadata({ provider, identity, owner: { utxo, unlocker: owner.signer.unlockP2PKH() },
    action: { kind: 'burn' }, changeAddress: owner.address });
  return r.tx.txid;
}
