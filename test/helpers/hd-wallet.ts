// A deterministic HD wallet for the address scan and signing tests (decision 0027), from the public BIP39 test phrase
// below (all "abandon" and "about"): it holds no value anywhere and is not the project's own test wallet. Keys follow
// BCH's BIP44 account m/44'/145'/0'; `receive` is chain 0 and `change` chain 1, as WizardConnect's paths are.
import {
  deriveHdPath, deriveHdPrivateNodeChild, deriveHdPrivateNodeFromBip39Mnemonic, deriveHdPublicNode,
  deriveHdPublicNodeChild,
  type HdPrivateNodeValid,
} from '@bitauth/libauth';
import type { ScanKeys, ScanPath } from '../../src/wallet/scan.js';

export const PUBLIC_TEST_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const CHAIN: Record<ScanPath, number> = { receive: 0, change: 1 };

export class HdTestWallet {
  private readonly account: HdPrivateNodeValid;

  constructor(phrase = PUBLIC_TEST_PHRASE) {
    this.account = deriveHdPath(deriveHdPrivateNodeFromBip39Mnemonic(phrase), "m/44'/145'/0'") as HdPrivateNodeValid;
  }

  privateKey(path: ScanPath, index: number): Uint8Array {
    return deriveHdPrivateNodeChild(deriveHdPrivateNodeChild(this.account, CHAIN[path]), index).privateKey;
  }

  publicKey(path: ScanPath, index: number): Uint8Array {
    return deriveHdPublicNodeChild(deriveHdPublicNodeChild(deriveHdPublicNode(this.account), CHAIN[path]), index)
      .publicKey;
  }

  /** The keys as a WizardConnect session would expose them; `shared` limits the chains (default both). */
  keys(shared: readonly ScanPath[] = ['receive', 'change']): ScanKeys {
    return { pubkey: (path, index) => (shared.includes(path) ? this.publicKey(path, index) : undefined) };
  }
}
