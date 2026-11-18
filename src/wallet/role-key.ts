// A role key that only a wallet can recreate. The escrow checks each party's signature with checkSig, and the
// SolidCash SDK needs that key while it builds a call (docs/SOLIDCASH-FINDINGS.md, F10), so a wallet that holds its
// key behind `bch_signTransaction` cannot sign the call itself. Instead the wallet signs a fixed message with
// `bch_signMessage`; the page checks that the signature recovers to the wallet's own key and hashes it into the role
// key. The same wallet, message and deterministic signing give the same key on any device (docs/decisions/0009).
import {
  base64ToBin,
  binToBase64,
  hash160,
  hash256,
  secp256k1,
  sha256,
  utf8ToBin,
  type RecoveryId,
} from '@bitauth/libauth';

export interface RoleKeyMessageFields {
  site: string;
  role: string;
  trade: string;
}

/** The message a wallet signs, from the template in config/jamin.json (`walletSigning.roleKeyMessage`). */
export function roleKeyMessage(template: string, fields: RoleKeyMessageFields): string {
  for (const [name, value] of Object.entries(fields)) {
    if (value.length === 0 || /[\r\n]/.test(value)) throw new Error(`role key field ${name} must be one non-empty line`);
  }
  const message = template.replace(/\{(site|role|trade)\}/g, (_m, k: keyof RoleKeyMessageFields) => fields[k]);
  if (/\{[a-z]+\}/.test(message)) throw new Error('role key message template has an unknown field');
  return message;
}

function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  throw new Error('message too long');
}

/** The Bitcoin Cash signed-message digest that `bch_signMessage` signs. */
export function messageHash(message: string): Uint8Array {
  const prefix = utf8ToBin('Bitcoin Signed Message:\n');
  const body = utf8ToBin(message);
  return hash256(Uint8Array.of(...compactSize(prefix.length), ...prefix, ...compactSize(body.length), ...body));
}

/** A base64 recoverable compact signature (header 31 + recovery id), as wallets return from `bch_signMessage`. */
export function signMessage(privateKey: Uint8Array, message: string): string {
  const result = secp256k1.signMessageHashRecoverableCompact(privateKey, messageHash(message));
  if (typeof result === 'string') throw new Error(result);
  return binToBase64(Uint8Array.of(31 + result.recoveryId, ...result.signature));
}

/** The compressed public key a signed message recovers to. */
export function recoverSigner(message: string, signatureBase64: string): Uint8Array {
  const bytes = base64ToBin(signatureBase64);
  const header = bytes[0] ?? 0;
  if (bytes.length !== 65 || header < 31 || header > 34) throw new Error('not a compressed-key message signature');
  const key = secp256k1.recoverPublicKeyCompressed(bytes.slice(1), (header - 31) as RecoveryId, messageHash(message));
  if (typeof key === 'string') throw new Error(key);
  return key;
}

/**
 * The role key behind `signatureBase64`, after checking that the signature over `message` was made by the wallet
 * whose public key hash is `walletPkh`. Anyone who gets the wallet to sign this exact message gets the key, so the
 * message names the site and the trade (docs/THREAT_MODEL.md).
 */
export function roleKeyFrom(message: string, signatureBase64: string, walletPkh: Uint8Array): Uint8Array {
  const signer = hash160(recoverSigner(message, signatureBase64));
  if (signer.length !== walletPkh.length || signer.some((b, i) => b !== walletPkh[i])) {
    throw new Error('the message was not signed by the connected wallet');
  }
  const key = sha256.hash(Uint8Array.of(...utf8ToBin('jamin role key'), ...base64ToBin(signatureBase64)));
  if (!secp256k1.validatePrivateKey(key)) throw new Error('derived role key is out of range; use another trade name');
  return key;
}
