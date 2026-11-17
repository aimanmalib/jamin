import { describe, expect, it } from 'vitest';
import { childPath, deriveKey, isValidMnemonic, newMnemonic } from '../src/wallet/keys.js';

// Public BIP39 test phrase; never holds funds.
const PUBLIC_VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('wallet keys', () => {
  it('derives the known BCH address for the public test phrase', () => {
    const key = deriveKey(PUBLIC_VECTOR, "m/44'/145'/0'/0/0");
    expect(key.address).toBe('bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6');
    expect(key.tokenAddress).toBe('bitcoincash:zqyx49mu0kkn9ftfj6hje6g2wfer34yfnqnpwfwhlf');
    expect(key.publicKey).toHaveLength(33);
  });

  it('gives each role path its own address', () => {
    const addresses = [0, 1, 2, 3].map((i) => deriveKey(PUBLIC_VECTOR, childPath("m/44'/145'/0'/0", i)).address);
    expect(new Set(addresses).size).toBe(4);
  });

  it('uses the regtest prefix when asked', () => {
    expect(deriveKey(PUBLIC_VECTOR, "m/44'/145'/0'/0/0", 'bchreg').address).toMatch(/^bchreg:q/);
  });

  it('rejects an invalid phrase without echoing it', () => {
    const bad = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(isValidMnemonic(bad)).toBe(false);
    expect(() => deriveKey(bad, "m/44'/145'/0'/0/0")).toThrowError(/not a valid BIP39 mnemonic/);
    try {
      deriveKey(bad, "m/44'/145'/0'/0/0");
    } catch (error) {
      expect(String(error)).not.toContain('abandon');
    }
  });

  it('generates valid 12 word phrases', () => {
    const phrase = newMnemonic();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(isValidMnemonic(phrase)).toBe(true);
  });

  it('rejects hardened or out of range child indexes', () => {
    expect(() => childPath('m/0', -1)).toThrow();
    expect(() => childPath('m/0', 0x80000000)).toThrow();
    expect(childPath('m/0', 3)).toBe('m/0/3');
  });
});
