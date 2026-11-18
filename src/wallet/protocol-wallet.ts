// The wallet side of the BCH WalletConnect method `bch_signTransaction` (wc2-bch-bcr), for one P2PKH key: given
// the transaction object a dapp proposes, it signs each input whose unlocking bytecode is empty and whose source
// output is its own P2PKH lock, and leaves every other input as it is (the SolidCash SDK sends all inputs empty and
// puts the others back itself). It refuses a request with none of its inputs. It also answers `bch_signMessage`.
// A phone wallet does the same behind a WalletConnect session; this one holds its key in the process, so the
// escrow's wallet path can be tested and run without one.
// Only libauth is imported, so the same code runs in Node and in the browser.
import {
  binToHex,
  encodeTransaction,
  generateSigningSerializationBCH,
  hash160,
  hash256,
  secp256k1,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';
import { signMessage } from './role-key.js';

/** SIGHASH_ALL | SIGHASH_FORKID: what the SDK's placeholder for a wallet input declares (docs/decisions/0009). */
export const WALLET_SIGHASH = 0x41;

/** The part of `WcTransactionObject` (wc2-bch-bcr) a wallet reads. */
export interface WalletSignRequest {
  transaction: TransactionCommon;
  sourceOutputs: readonly Output[];
  broadcast?: boolean;
  userPrompt?: string;
}

export interface SignedTx {
  signedTransaction: string;
  signedTransactionHash: string;
}

/** What a wallet showed and signed, for the page's log and for tests. */
export interface SignRecord {
  userPrompt: string | undefined;
  inputs: number[];
}

export class WalletRefusal extends Error {}

export class ProtocolWallet {
  readonly publicKey: Uint8Array;
  readonly lockingBytecode: Uint8Array;
  readonly signed: SignRecord[] = [];

  constructor(private readonly privateKey: Uint8Array) {
    const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
    if (typeof publicKey === 'string') throw new Error('invalid wallet key');
    this.publicKey = publicKey;
    this.lockingBytecode = Uint8Array.of(0x76, 0xa9, 0x14, ...hash160(publicKey), 0x88, 0xac);
  }

  /** `bch_signTransaction`: signs this wallet's empty inputs; the dapp broadcasts. */
  async signTransaction(request: WalletSignRequest): Promise<SignedTx> {
    return Promise.resolve(this.sign(request));
  }

  /** `bch_signMessage`: a base64 recoverable signature of the Bitcoin Cash signed-message digest. */
  async signMessage(message: string): Promise<string> {
    return Promise.resolve(signMessage(this.privateKey, message));
  }

  get pkh(): Uint8Array {
    return hash160(this.publicKey);
  }

  private sign({ transaction, sourceOutputs, userPrompt }: WalletSignRequest): SignedTx {
    if (sourceOutputs.length !== transaction.inputs.length) throw new WalletRefusal('one source output per input');
    const own = transaction.inputs.flatMap((input, i) =>
      input.unlockingBytecode.length === 0 && sameBytes(sourceOutputs[i]?.lockingBytecode, this.lockingBytecode) ? [i] : []);
    if (own.length === 0) throw new WalletRefusal('no input of this wallet to sign');
    const context = { transaction, sourceOutputs: [...sourceOutputs], inputIndex: 0 };
    const inputs = transaction.inputs.map((input, inputIndex) => {
      if (!own.includes(inputIndex)) return input;
      const serialization = generateSigningSerializationBCH({ ...context, inputIndex },
        { coveredBytecode: this.lockingBytecode, signingSerializationType: Uint8Array.of(WALLET_SIGHASH) });
      const signature = secp256k1.signMessageHashSchnorr(this.privateKey, hash256(serialization));
      if (typeof signature === 'string') throw new Error(signature);
      const unlockingBytecode = Uint8Array.of(65, ...signature, WALLET_SIGHASH, 33, ...this.publicKey);
      return { ...input, unlockingBytecode };
    });
    const encoded = encodeTransaction({ ...transaction, inputs });
    this.signed.push({ userPrompt, inputs: own });
    return { signedTransaction: binToHex(encoded), signedTransactionHash: binToHex(hash256(encoded).reverse()) };
  }
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}
