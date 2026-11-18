// A wallet behind WizardConnect (docs/decisions/0014) in the shape the SolidCash SDK's `Signer.external` expects.
// The SDK hands over a transaction with every input empty; this adapter names the inputs at the wallet's `receive/0`
// key in `inputPaths`, sends the request in the relay's wire form (hex bytes, `<bigint: Nn>` numbers) and checks each
// signature the wallet returns against that key before the SDK uses the transaction. WizardConnect has no message
// signing, so the seller's role key (decision 0009) comes from the wallet's signature over one fixed request that
// spends a made-up outpoint and is never broadcast; a WizardConnect wallet signs deterministically (Schnorr with a
// derived nonce), so the same wallet and trade give the same key again.
// Only libauth is imported, so the same code runs in Node and in the browser.
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  generateSigningSerializationBCH,
  hash160,
  hash256,
  hexToBin,
  secp256k1,
  sha256,
  utf8ToBin,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';
import { WalletRefusal, type SignRecord, type SignedTx, type WalletSignRequest } from './protocol-wallet.js';

/** SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID: the hash type the WizardConnect protocol signs every input with. */
export const WIZ_SIGHASH = 0x61;

export type WizPathName = 'receive' | 'change' | 'defi';

type Wire = string | number | boolean | null | Wire[] | { [key: string]: Wire };

/** A sign request as `DappConnectionManager.signTransaction` sends it over the relay. */
export interface WizSignRequest {
  transaction: { transaction: string; sourceOutputs: Wire[]; broadcast: false; userPrompt?: string };
  inputPaths: [number, WizPathName, number][];
}

/** The part of a WizardConnect dapp session this adapter uses. */
export interface WizTransport {
  signTransaction(request: WizSignRequest): Promise<{ signedTransaction: string }>;
}

/** Bytes as hex and integers as `<bigint: Nn>`, the encoding the WizardConnect reference serializer uses. */
export function toWire(value: unknown): Wire {
  if (value instanceof Uint8Array) return binToHex(value);
  if (typeof value === 'bigint') return `<bigint: ${value.toString()}n>`;
  if (Array.isArray(value)) return value.map(toWire);
  if (value === undefined) return null;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toWire(v)]));
  }
  return value as Wire;
}

/**
 * The relay form of `request` with `own` signed at `receive/<index>`. Source outputs carry no `contract` field, so a
 * wallet leaves the contract inputs as the SDK sent them (empty) and the SDK fills them in afterwards.
 */
export function wizRequest(request: WalletSignRequest, own: number[], index = 0): WizSignRequest {
  const sourceOutputs = request.transaction.inputs.map((input, i) => {
    const source = request.sourceOutputs[i] as Output;
    return toWire({ outpointIndex: input.outpointIndex, outpointTransactionHash: input.outpointTransactionHash,
      sequenceNumber: input.sequenceNumber, unlockingBytecode: input.unlockingBytecode,
      lockingBytecode: source.lockingBytecode, valueSatoshis: source.valueSatoshis, token: source.token });
  });
  return {
    transaction: { transaction: binToHex(encodeTransaction(request.transaction)), sourceOutputs, broadcast: false,
      ...(request.userPrompt === undefined ? {} : { userPrompt: request.userPrompt }) },
    inputPaths: own.map((i) => [i, 'receive', index]),
  };
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The 65-byte signature of a P2PKH unlocking bytecode `<sig> <pubkey>`, or undefined for another shape. */
export function p2pkhSignature(unlocking: Uint8Array): Uint8Array | undefined {
  return unlocking.length === 100 && unlocking[0] === 65 && unlocking[66] === 33 ? unlocking.slice(1, 66) : undefined;
}

export class WizardWallet {
  readonly lockingBytecode: Uint8Array;
  readonly signed: SignRecord[] = [];

  /** `publicKey` is the wallet's `receive/0` key, from the xpub it shared when the session opened. */
  constructor(private readonly transport: WizTransport, readonly publicKey: Uint8Array) {
    this.lockingBytecode = Uint8Array.of(0x76, 0xa9, 0x14, ...hash160(publicKey), 0x88, 0xac);
  }

  get pkh(): Uint8Array {
    return hash160(this.publicKey);
  }

  /** `bch_signTransaction` for `Signer.external`: the wallet signs its own inputs; the dapp broadcasts. */
  async signTransaction(request: WalletSignRequest): Promise<SignedTx> {
    const { transaction, sourceOutputs } = request;
    if (sourceOutputs.length !== transaction.inputs.length) throw new WalletRefusal('one source output per input');
    const own = transaction.inputs.flatMap((input, i) =>
      input.unlockingBytecode.length === 0 && sameBytes(sourceOutputs[i]?.lockingBytecode, this.lockingBytecode) ? [i] : []);
    if (own.length === 0) throw new WalletRefusal('no input of this wallet to sign');
    const { signedTransaction } = await this.transport.signTransaction(wizRequest(request, own));
    const signed = decodeTransaction(hexToBin(signedTransaction));
    if (typeof signed === 'string') throw new WalletRefusal(`the wallet returned a transaction that does not decode: ${signed}`);
    for (const i of own) this.checkSignature(signed, sourceOutputs, i);
    this.signed.push({ userPrompt: request.userPrompt, inputs: own });
    return { signedTransaction, signedTransactionHash: binToHex(hash256(hexToBin(signedTransaction)).reverse()) };
  }

  /** Throws unless input `i` of `signed` carries a valid signature of this wallet's key over its P2PKH lock. */
  private checkSignature(signed: TransactionCommon, sourceOutputs: readonly Output[], i: number): void {
    const unlocking = signed.inputs[i]?.unlockingBytecode ?? Uint8Array.of();
    const sig = p2pkhSignature(unlocking);
    if (sig === undefined || !sameBytes(unlocking.slice(67), this.publicKey)) {
      throw new WalletRefusal(`input ${i} is not signed by the connected wallet key`);
    }
    const digest = hash256(generateSigningSerializationBCH({ transaction: signed, sourceOutputs: [...sourceOutputs],
      inputIndex: i }, { coveredBytecode: this.lockingBytecode, signingSerializationType: sig.slice(64) }));
    if (!secp256k1.verifySignatureSchnorr(sig.slice(0, 64), this.publicKey, digest)) {
      throw new WalletRefusal(`the wallet's signature on input ${i} does not verify`);
    }
  }
}

/**
 * The fixed request a wallet signs for a role key: one made-up input at the wallet's lock whose outpoint is the
 * message's hash, and one zero-value data output carrying that hash. It cannot be broadcast: the outpoint does not
 * exist. The wallet shows `message` as the request's prompt.
 */
export function roleKeyRequest(message: string, lockingBytecode: Uint8Array, valueSats: bigint): WalletSignRequest {
  const id = sha256.hash(utf8ToBin(message));
  const transaction: TransactionCommon = { version: 2, locktime: 0,
    inputs: [{ outpointIndex: 0, outpointTransactionHash: id, sequenceNumber: 0, unlockingBytecode: Uint8Array.of() }],
    outputs: [{ lockingBytecode: Uint8Array.of(0x6a, 32, ...id), valueSatoshis: 0n }] };
  return { transaction, sourceOutputs: [{ lockingBytecode, valueSatoshis: valueSats }], broadcast: false,
    userPrompt: message };
}

/** The role key from the wallet's signature over `roleKeyRequest(message)`, checked against the wallet's key. */
export async function wizardRoleKey(wallet: WizardWallet, message: string, valueSats: bigint): Promise<Uint8Array> {
  const { signedTransaction } = await wallet.signTransaction(roleKeyRequest(message, wallet.lockingBytecode, valueSats));
  const signed = decodeTransaction(hexToBin(signedTransaction));
  if (typeof signed === 'string') throw new WalletRefusal(signed);
  const sig = p2pkhSignature(signed.inputs[0]?.unlockingBytecode ?? Uint8Array.of());
  if (sig === undefined) throw new WalletRefusal('the role key request came back unsigned');
  const key = sha256.hash(Uint8Array.of(...utf8ToBin('jamin role key'), ...sig));
  if (!secp256k1.validatePrivateKey(key)) throw new Error('derived role key is out of range; use another trade name');
  return key;
}
