// Sizes of a broadcast transaction, read back from the network: the whole transaction and its largest unlocking
// script (the per-input limit is 10,000 bytes).
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import type { NetworkProvider } from '@solidcash/solidcash';
import type { Step } from './context.js';

export interface MeasuredStep extends Step {
  txBytes: number;
  inputs: number;
  outputs: number;
  maxUnlockingBytes: number;
}

export async function measure(provider: NetworkProvider, step: Step): Promise<MeasuredStep> {
  const hex = await provider.getRawTransaction(step.txid);
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(`cannot decode ${step.txid}: ${tx}`);
  const maxUnlockingBytes = Math.max(...tx.inputs.map((i) => i.unlockingBytecode.length));
  return { ...step, txBytes: hex.length / 2, inputs: tx.inputs.length, outputs: tx.outputs.length, maxUnlockingBytes };
}
