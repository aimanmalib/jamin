// Sizes and miner fee of a broadcast transaction, read back from the network: the whole transaction, its largest
// unlocking script (the per-input limit is 10,000 bytes) and the satoshis its inputs spend beyond its outputs.
import { binToHex, decodeTransaction, hexToBin, type TransactionCommon } from '@bitauth/libauth';
import type { NetworkProvider } from '@solidcash/solidcash';
import type { Step } from './context.js';

export interface MeasuredStep extends Step {
  txBytes: number;
  inputs: number;
  outputs: number;
  maxUnlockingBytes: number;
  /** Miner fee in satoshis; absent when a spent transaction cannot be read back. */
  feeSats?: number;
}

function decode(hex: string, txid: string): TransactionCommon {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(`cannot decode ${txid}: ${tx}`);
  return tx;
}

/** Inputs minus outputs, with each input's value read from the transaction it spends. */
export async function minerFee(provider: NetworkProvider, tx: TransactionCommon): Promise<number | undefined> {
  const spent = new Map<string, TransactionCommon>();
  let inValue = 0n;
  for (const input of tx.inputs) {
    // libauth decodes outpoint hashes in txid (display) byte order.
    const prevId = binToHex(input.outpointTransactionHash);
    let prev = spent.get(prevId);
    if (prev === undefined) {
      try {
        prev = decode(await provider.getRawTransaction(prevId), prevId);
      } catch {
        return undefined;
      }
      spent.set(prevId, prev);
    }
    const out = prev.outputs[input.outpointIndex];
    if (out === undefined) return undefined;
    inValue += out.valueSatoshis;
  }
  const outValue = tx.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
  return Number(inValue - outValue);
}

export async function measure(provider: NetworkProvider, step: Step): Promise<MeasuredStep> {
  const hex = await provider.getRawTransaction(step.txid);
  const tx = decode(hex, step.txid);
  const maxUnlockingBytes = Math.max(...tx.inputs.map((i) => i.unlockingBytecode.length));
  const feeSats = await minerFee(provider, tx);
  return { ...step, txBytes: hex.length / 2, inputs: tx.inputs.length, outputs: tx.outputs.length, maxUnlockingBytes,
    ...(feeSats === undefined ? {} : { feeSats }) };
}
