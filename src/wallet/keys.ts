import {
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  decodeBip39Mnemonic,
  encodeCashAddress,
  generateBip39Mnemonic,
  hash160,
  privateKeyToP2pkhCashAddress,
  secp256k1,
} from '@bitauth/libauth';

export type AddressPrefix = 'bitcoincash' | 'bchtest' | 'bchreg';

export interface DerivedKey {
  path: string;
  /** Compressed public key, 33 bytes. */
  publicKey: Uint8Array;
  /** Kept inside the process for signing; never printed or written to disk. */
  privateKey: Uint8Array;
  address: string;
  /** Token-aware form of the same address (CashTokens wallets require it). */
  tokenAddress: string;
}

export function newMnemonic(): string {
  return generateBip39Mnemonic();
}

export function isValidMnemonic(mnemonic: string): boolean {
  return typeof decodeBip39Mnemonic(mnemonic) !== 'string';
}

export function childPath(base: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error(`invalid child index ${index}`);
  return `${base}/${index}`;
}

export function deriveKey(mnemonic: string, path: string, prefix: AddressPrefix = 'bitcoincash'): DerivedKey {
  if (!isValidMnemonic(mnemonic)) throw new Error('wallet phrase is not a valid BIP39 mnemonic');
  const root = deriveHdPrivateNodeFromBip39Mnemonic(mnemonic);
  const node = deriveHdPath(root, path);
  if (typeof node === 'string') throw new Error(`cannot derive ${path}: ${node}`);
  const publicKey = secp256k1.derivePublicKeyCompressed(node.privateKey);
  if (typeof publicKey === 'string') throw new Error(`cannot derive public key for ${path}`);
  const { address } = privateKeyToP2pkhCashAddress({ privateKey: node.privateKey, prefix });
  const { address: tokenAddress } = encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload: hash160(publicKey) });
  return { path, publicKey, privateKey: node.privateKey, address, tokenAddress };
}
