// Branch R tools (decision 0015): re-signing a built transaction so the network judges a call the contract forbids,
// and taking a call's final transaction at the provider before it is broadcast. Keys come from the public BIP39
// test phrase.
import {
  binToHex, encodeTransaction, generateSigningSerializationBCH, hash160, hash256, secp256k1, type Output,
  type TransactionBCH,
} from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { childPath, deriveKey } from '../src/wallet/keys.js';
import { coverCandidates, resign } from '../src/lifecycle/resign.js';
import { capture, onlyP2pkh } from '../src/lifecycle/refused.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const A = deriveKey(PHRASE, childPath("m/44'/145'/0'/0", 0));
const B = deriveKey(PHRASE, childPath("m/44'/145'/0'/0", 1));
const at = <T>(xs: readonly T[], i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element ${i}`);
  return v;
};
const TYPE = 0x61; // SIGHASH_ALL | SIGHASH_UTXOS | FORKID

const push = (d: Uint8Array): Uint8Array => Uint8Array.of(d.length <= 75 ? d.length : 0x4c, ...(d.length <= 75 ? [] : [d.length]), ...d);
const BODY = Uint8Array.of(0x51, 0xad, 0x75, 0x51, 0x51, 0x51, 0x51, 0x51, 0x51, 0x51); // a function body pushed in the redeem
const REDEEM = Uint8Array.of(...push(BODY), 0x51, 0x89, 0x51); // <body> OP_1 OP_DEFINE OP_1 (shape only)
const p2pkh = (pkh: Uint8Array): Uint8Array => Uint8Array.of(0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac);
const SOURCES: Output[] = [
  { lockingBytecode: Uint8Array.of(0xaa, 0x20, ...hash256(REDEEM), 0x87), valueSatoshis: 10_000n },
  { lockingBytecode: p2pkh(hash160(A.publicKey)), valueSatoshis: 5_000n },
];

function sign(tx: TransactionBCH, i: number, covered: Uint8Array, key: Uint8Array): Uint8Array {
  const digest = hash256(generateSigningSerializationBCH({ inputIndex: i, sourceOutputs: SOURCES, transaction: tx },
    { coveredBytecode: covered, signingSerializationType: Uint8Array.of(TYPE) }));
  const sig = secp256k1.signMessageHashSchnorr(key, digest);
  if (typeof sig === 'string') throw new Error(sig);
  return Uint8Array.of(...sig, TYPE);
}

function verifies(tx: TransactionBCH, i: number, covered: Uint8Array, sig: Uint8Array, pub: Uint8Array): boolean {
  const digest = hash256(generateSigningSerializationBCH({ inputIndex: i, sourceOutputs: SOURCES, transaction: tx },
    { coveredBytecode: covered, signingSerializationType: Uint8Array.of(TYPE) }));
  return secp256k1.verifySignatureSchnorr(sig.slice(0, 64), pub, digest);
}

/** A two-input transaction: a contract input whose signature covers BODY, and a P2PKH fee input, both signed by A. */
function signedByA(): TransactionBCH {
  const tx: TransactionBCH = { version: 2, locktime: 1_800_000_000, outputs: [{ lockingBytecode: p2pkh(new Uint8Array(20)),
    valueSatoshis: 14_000n }], inputs: [0, 1].map((n) => ({ outpointTransactionHash: new Uint8Array(32).fill(n + 1),
    outpointIndex: n, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() })) };
  const contractSig = sign(tx, 0, BODY, A.privateKey);
  const feeSig = sign(tx, 1, at(SOURCES, 1).lockingBytecode, A.privateKey);
  return { ...tx, inputs: [
    { ...at(tx.inputs, 0), unlockingBytecode: Uint8Array.of(...push(contractSig), ...push(REDEEM)) },
    { ...at(tx.inputs, 1), unlockingBytecode: Uint8Array.of(...push(feeSig), ...push(A.publicKey)) },
  ] };
}

const sigOf = (tx: TransactionBCH, i: number): Uint8Array => at(tx.inputs, i).unlockingBytecode.slice(1, 66);

describe('resign', () => {
  it('finds the function body a contract signature covers', () => {
    expect(coverCandidates(REDEEM).map(binToHex)).toContain(binToHex(BODY));
  });

  it('replaces only the contract signature with the other party\'s, over the same covered bytecode', () => {
    const tx = signedByA();
    const { transaction, replaced } = resign(tx, SOURCES, A.publicKey, B.privateKey, { inputs: 'p2sh' });
    expect(replaced).toBe(1);
    expect(verifies(transaction, 0, BODY, sigOf(transaction, 0), B.publicKey)).toBe(true);
    expect(verifies(transaction, 0, BODY, sigOf(transaction, 0), A.publicKey)).toBe(false);
    expect(binToHex(at(transaction.inputs, 1).unlockingBytecode)).toBe(binToHex(at(tx.inputs, 1).unlockingBytecode));
    expect(encodeTransaction(transaction).length).toBe(encodeTransaction(tx).length);
  });

  it('moves the locktime and signs every input again with the same key', () => {
    const tx = signedByA();
    const { transaction, replaced } = resign(tx, SOURCES, A.publicKey, A.privateKey,
      { inputs: 'all', mutate: (t) => ({ ...t, locktime: 1_700_000_000 }) });
    expect(replaced).toBe(2);
    expect(transaction.locktime).toBe(1_700_000_000);
    expect(verifies(transaction, 0, BODY, sigOf(transaction, 0), A.publicKey)).toBe(true);
    expect(verifies(transaction, 1, at(SOURCES, 1).lockingBytecode, sigOf(transaction, 1), A.publicKey)).toBe(true);
    // The old signatures do not hold for the new locktime.
    expect(verifies(transaction, 0, BODY, sigOf(tx, 0), A.publicKey)).toBe(false);
  });

  it('throws when the key signed nothing in the chosen inputs', () => {
    expect(() => resign(signedByA(), SOURCES, B.publicKey, A.privateKey, { inputs: 'all' })).toThrow(/no signature/);
  });
});

describe('capture', () => {
  const tx = signedByA();
  const contractHex = binToHex(encodeTransaction(tx));
  const plainHex = binToHex(encodeTransaction({ ...tx, inputs: [at(tx.inputs, 1)] }));

  it('tells a plain wallet payment from a contract call', () => {
    expect(onlyP2pkh(plainHex)).toBe(true);
    expect(onlyP2pkh(contractHex)).toBe(false);
  });

  it('lets wallet payments through, takes the contract call, and restores the provider', async () => {
    const sent: string[] = [];
    class Provider { sendRawTransaction(hex: string): Promise<string> { sent.push(hex); return Promise.resolve('ok'); } }
    const provider = new Provider();
    let after = '';
    const hex = await capture(provider, async () => {
      await provider.sendRawTransaction(plainHex);
      await provider.sendRawTransaction(contractHex);
      after = 'broadcast';
    });
    expect(hex).toBe(contractHex);
    expect(sent).toEqual([plainHex]);
    expect(after).toBe('');
    expect(Object.getOwnPropertyNames(provider)).toEqual([]);
    expect('sendPreparedTransaction' in provider).toBe(false);
  });

  it('passes on an error from before anything was taken', async () => {
    await expect(capture({ sendRawTransaction: () => Promise.resolve('x') }, () => Promise.reject(new Error('NotSeller'))))
      .rejects.toThrow('NotSeller');
  });
});
