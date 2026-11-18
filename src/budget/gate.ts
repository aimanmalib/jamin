// The spending gate every mainnet broadcast goes through. It wraps a network provider so that sending a transaction
// first works out what the transaction takes out of the test wallet, refuses before broadcasting when that would pass
// the budget, and records the spend in the ledger once the network accepted it. A broadcast the network refuses is
// recorded as an attempt of 0 sat (decision 0015).
import { binToHex, decodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import type { NetworkProvider } from '@solidcash/solidcash';
import { checkBudget, readLedger, recordSpend } from './ledger.js';

export interface Prevout {
  lockingBytecode: Uint8Array;
  satoshis: bigint;
}

/** Looks up the output a transaction input spends. */
export type PrevoutLookup = (txid: string, vout: number) => Promise<Prevout>;

/** Prevouts read from the raw transactions the provider returns. */
export function prevoutsFrom(provider: Pick<NetworkProvider, 'getRawTransaction'>): PrevoutLookup {
  return async (txid, vout) => {
    const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(txid)));
    if (typeof tx === 'string') throw new Error(`cannot decode ${txid}: ${tx}`);
    const out = tx.outputs[vout];
    if (!out) throw new Error(`${txid} has no output ${vout}`);
    return { lockingBytecode: out.lockingBytecode, satoshis: out.valueSatoshis };
  };
}

/**
 * Satoshis a transaction takes out of the wallet: what its inputs from wallet locks hold, minus what its outputs pay
 * back to wallet locks, never below zero. Coins paid out of an escrow back to the wallet are not credited, so the
 * ledger can only overstate what left the wallet.
 */
export async function walletSpend(txHex: string, walletLocks: ReadonlySet<string>, prevout: PrevoutLookup): Promise<number> {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') throw new Error(`cannot decode the transaction to broadcast: ${tx}`);
  let spent = 0n;
  for (const input of tx.inputs) {
    // libauth keeps the outpoint hash in display order, the order a txid is written in.
    const p = await prevout(binToHex(input.outpointTransactionHash), input.outpointIndex);
    if (walletLocks.has(binToHex(p.lockingBytecode))) spent += p.satoshis;
  }
  for (const out of tx.outputs) {
    if (walletLocks.has(binToHex(out.lockingBytecode))) spent -= out.valueSatoshis;
  }
  return spent > 0n ? Number(spent) : 0;
}

export interface GateOptions {
  ledgerFile: string;
  budgetSats: number;
  /** Locking bytecodes, as hex, of every test wallet address in use. */
  walletLocks: ReadonlySet<string>;
  /** Defaults to reading prevouts through the provider itself. */
  prevout?: PrevoutLookup;
  note: string;
}

const BROADCAST = 'blockchain.transaction.broadcast';
/** Provider methods that publish a transaction under another name; the gate refuses them. */
const OTHER_PUBLISH = /^(send|broadcast|publish|submit)/i;

interface Prepared { rawHex: string }
type Fn = (...a: unknown[]) => unknown;

/**
 * `provider` with every broadcast checked against the budget first and recorded after. The SDK broadcasts through
 * `sendRawTransaction`, or `sendPreparedTransaction` where a provider has it; both are gated, and any other method
 * that would publish a transaction is refused.
 */
export function gateProvider<P extends NetworkProvider>(provider: P, opts: GateOptions): P {
  const prevout = opts.prevout ?? prevoutsFrom(provider);
  const gated = (send: Fn, hexOf: (arg: unknown) => string) => async (arg: unknown): Promise<string> => {
    const spentSats = await walletSpend(hexOf(arg), opts.walletLocks, prevout);
    checkBudget(readLedger(opts.ledgerFile), opts.budgetSats, spentSats);
    let txid: string;
    try {
      txid = await send.call(provider, arg) as string;
    } catch (e) {
      // A transaction a run takes before broadcasting (branch R, refused.ts) never reached the network.
      if (!(e instanceof Error && e.name === 'CapturedTransaction')) {
        recordSpend(opts.ledgerFile, { network: 'mainnet', txid: hashTransaction(hexToBin(hexOf(arg))), spentSats: 0,
          note: `${opts.note}: refused: ${(e as Error).message.slice(0, 200)}`, refused: true });
      }
      throw e;
    }
    recordSpend(opts.ledgerFile, { network: 'mainnet', txid, spentSats, note: opts.note });
    return txid;
  };
  return new Proxy(provider, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const fn = value as Fn;
      if (prop === 'sendRawTransaction') return gated(fn, (hex) => hex as string);
      if (prop === 'sendPreparedTransaction') return gated(fn, (p) => (p as Prepared).rawHex);
      if (prop === 'performRequest') {
        return (name: string, ...args: unknown[]): unknown => {
          if (name === BROADCAST) throw new Error('broadcasts go through sendRawTransaction and the budget check');
          return fn.call(target, name, ...args);
        };
      }
      if (typeof prop === 'string' && OTHER_PUBLISH.test(prop)) {
        return () => { throw new Error(`${prop} is not gated by the budget check; refused`); };
      }
      return fn.bind(target);
    },
  });
}
