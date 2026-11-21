// A stand-in for a WizardConnect wallet, for tests without a relay: it reads a request in the relay's wire form the
// way Cashonize does (hex bytes, `<bigint: Nn>` numbers), signs each input listed in `inputPaths` with the key of the
// path it names (one key for every path unless `keyAt` is given; decision 0027) and the protocol's hash type, and leaves every other input as it came.
import {
  binToHex, decodeTransaction, encodeDataPush, encodeTransaction, generateSigningSerializationBCH, hash256, hexToBin,
  secp256k1, type Output,
} from '@bitauth/libauth';
import { WIZ_SIGHASH, type WizPathName, type WizSignRequest, type WizTransport } from '../../src/wallet/wizard.js';

const BIGINT = /^<bigint: (\d+)n>$/;

function fromWire(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    const n = BIGINT.exec(value);
    if (n) return BigInt(n[1] ?? '0');
    if (/Bytecode|Hash|category|commitment/.test(key)) return hexToBin(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => fromWire(v));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromWire(v, k)]));
  }
  return value;
}

export class FakeWizWallet implements WizTransport {
  readonly requests: WizSignRequest[] = [];
  readonly publicKey: Uint8Array;

  constructor(private readonly privateKey: Uint8Array,
    private readonly keyAt?: (path: WizPathName, index: number) => Uint8Array) {
    this.publicKey = FakeWizWallet.pub(privateKey);
  }

  private static pub(privateKey: Uint8Array): Uint8Array {
    const pub = secp256k1.derivePublicKeyCompressed(privateKey);
    if (typeof pub === 'string') throw new Error(pub);
    return pub;
  }

  signTransaction(request: WizSignRequest): Promise<{ signedTransaction: string }> {
    this.requests.push(request);
    const tx = decodeTransaction(hexToBin(request.transaction.transaction));
    if (typeof tx === 'string') throw new Error(tx);
    const sourceOutputs = fromWire(request.transaction.sourceOutputs) as Output[];
    const paths = new Map(request.inputPaths.map(([i, path, index]) => [i, { path, index }]));
    const inputs = tx.inputs.map((input, inputIndex) => {
      const at = paths.get(inputIndex);
      if (at === undefined) return input;
      const privateKey = this.keyAt?.(at.path, at.index) ?? this.privateKey;
      const source = sourceOutputs[inputIndex] as Output;
      const digest = hash256(generateSigningSerializationBCH({ transaction: tx, sourceOutputs, inputIndex },
        { coveredBytecode: source.lockingBytecode, signingSerializationType: Uint8Array.of(WIZ_SIGHASH) }));
      const sig = secp256k1.signMessageHashSchnorr(privateKey, digest);
      if (typeof sig === 'string') throw new Error(sig);
      return { ...input, unlockingBytecode: Uint8Array.of(...encodeDataPush(Uint8Array.of(...sig, WIZ_SIGHASH)),
        ...encodeDataPush(FakeWizWallet.pub(privateKey))) };
    });
    return Promise.resolve({ signedTransaction: binToHex(encodeTransaction({ ...tx, inputs })) });
  }
}
