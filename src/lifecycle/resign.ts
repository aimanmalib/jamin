// Re-signs a built transaction at the byte level, so a lifecycle run can send a transaction the contract must refuse
// (signed by the wrong party, or with a locktime before the waiting time) past the SDK, which evaluates every call
// locally and stops before broadcasting. The node then judges it (docs/decisions/0015-refused-on-the-network.md).
// Only 65-byte Schnorr signatures are touched, and each is first verified against `from` under the original
// transaction, which proves the signing serialization here is the one the signer used. A contract signature covers
// the bytecode of the function that checks it (a body defined with OP_DEFINE and run with OP_INVOKE), not the whole
// redeem script, so the covered bytecode is found the same way: the pushed bytecode under which the signature verifies.
import {
  binToHex, decodeAuthenticationInstructions, generateSigningSerializationBCH, hash256, secp256k1, type Output,
  type TransactionBCH,
} from '@bitauth/libauth';

export interface Resigned { transaction: TransactionBCH; replaced: number }

export interface ResignOptions {
  /** `p2sh`: only contract inputs (the authorisation); `all`: also the P2PKH inputs that pay the fee. */
  inputs: 'p2sh' | 'all';
  /** Changes made to the transaction before signing again (for example its locktime). */
  mutate?: (tx: TransactionBCH) => TransactionBCH;
}

function isP2sh(lock: Uint8Array): boolean {
  // OP_HASH160 <20> OP_EQUAL or OP_HASH256 <32> OP_EQUAL
  return (lock.length === 23 && lock[0] === 0xa9 && lock[1] === 0x14 && lock[22] === 0x87)
    || (lock.length === 35 && lock[0] === 0xaa && lock[1] === 0x20 && lock[34] === 0x87);
}

function pushes(bytecode: Uint8Array): Uint8Array[] {
  return decodeAuthenticationInstructions(bytecode)
    .flatMap((i) => ('data' in i && i.data instanceof Uint8Array ? [i.data] : []));
}

/** The redeem script and every bytecode pushed inside it, a few levels deep: what a signature may cover. */
export function coverCandidates(redeem: Uint8Array, depth = 3): Uint8Array[] {
  const out = [redeem];
  if (depth === 0) return out;
  for (const d of pushes(redeem)) if (d.length > 8) out.push(...coverCandidates(d, depth - 1));
  return out;
}

function digest(tx: TransactionBCH, sourceOutputs: Output[], inputIndex: number, covered: Uint8Array,
  type: number): Uint8Array {
  return hash256(generateSigningSerializationBCH({ inputIndex, sourceOutputs, transaction: tx },
    { coveredBytecode: covered, signingSerializationType: Uint8Array.of(type) }));
}

function replaceBytes(haystack: Uint8Array, needle: Uint8Array, value: Uint8Array): Uint8Array {
  const hex = binToHex(haystack);
  const at = hex.indexOf(binToHex(needle));
  if (at < 0 || at % 2 !== 0) throw new Error('signature not found in the unlocking bytecode');
  const out = haystack.slice();
  out.set(value, at / 2);
  return out;
}

/**
 * The transaction with every Schnorr signature by `fromPublicKey` (in the chosen inputs) replaced by one from
 * `toPrivateKey` over the possibly mutated transaction. Throws when no signature by `fromPublicKey` was found.
 */
export function resign(original: TransactionBCH, sourceOutputs: Output[], fromPublicKey: Uint8Array,
  toPrivateKey: Uint8Array, opts: ResignOptions): Resigned {
  const target = opts.mutate ? opts.mutate(original) : original;
  let replaced = 0;
  const inputs = target.inputs.map((input, i) => {
    const source = sourceOutputs[i];
    const before = original.inputs[i];
    if (!source || !before) throw new Error(`input ${i} has no source output`);
    const p2sh = isP2sh(source.lockingBytecode);
    if (!p2sh && opts.inputs === 'p2sh') return input;
    const data = pushes(before.unlockingBytecode);
    const redeem = data[data.length - 1];
    if (p2sh && !redeem) return input;
    const candidates = p2sh && redeem ? coverCandidates(redeem) : [source.lockingBytecode];
    let unlocking = input.unlockingBytecode;
    for (const sig of data.filter((d) => d.length === 65)) {
      const type = sig[64] ?? 0;
      const covered = candidates.find((c) => secp256k1.verifySignatureSchnorr(sig.slice(0, 64), fromPublicKey,
        digest(original, sourceOutputs, i, c, type)));
      if (!covered) continue;
      const fresh = secp256k1.signMessageHashSchnorr(toPrivateKey, digest(target, sourceOutputs, i, covered, type));
      if (typeof fresh === 'string') throw new Error(fresh);
      unlocking = replaceBytes(unlocking, sig, Uint8Array.of(...fresh, type));
      replaced += 1;
    }
    return { ...input, unlockingBytecode: unlocking };
  });
  if (replaced === 0) throw new Error('no signature by the given key in the chosen inputs');
  return { transaction: { ...target, inputs }, replaced };
}
