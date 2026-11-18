import { describe, expect, it } from 'vitest';
import {
  decodeTransaction,
  generateSigningSerializationBCH,
  hash160,
  hash256,
  hexToBin,
  secp256k1,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';
import { ProtocolWallet, WALLET_SIGHASH, WalletRefusal } from '../src/wallet/protocol-wallet.js';
import { recoverSigner, roleKeyFrom, roleKeyMessage, signMessage } from '../src/wallet/role-key.js';
import { loadConfig } from '../src/config.js';

// Throwaway test keys; they never hold funds.
const WALLET_KEY = new Uint8Array(32).fill(0x11);
const OTHER_KEY = new Uint8Array(32).fill(0x22);
const TEMPLATE = loadConfig().walletSigning.roleKeyMessage;
const FIELDS = { site: 'jamin.example', role: 'seller', trade: 'trade-1' };

function p2pkh(key: Uint8Array): Uint8Array {
  return new ProtocolWallet(key).lockingBytecode;
}

/** Two inputs, one at the wallet's lock and one elsewhere, both empty, and one output. */
function proposal(): { transaction: TransactionCommon; sourceOutputs: Output[] } {
  const outpoint = (n: number): Uint8Array => new Uint8Array(32).fill(n);
  return {
    transaction: {
      version: 2, locktime: 0,
      inputs: [
        { outpointTransactionHash: outpoint(1), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() },
        { outpointTransactionHash: outpoint(2), outpointIndex: 1, sequenceNumber: 0, unlockingBytecode: new Uint8Array() },
      ],
      outputs: [{ lockingBytecode: p2pkh(OTHER_KEY), valueSatoshis: 9_000n }],
    },
    sourceOutputs: [
      { lockingBytecode: p2pkh(OTHER_KEY), valueSatoshis: 5_000n },
      { lockingBytecode: p2pkh(WALLET_KEY), valueSatoshis: 5_000n },
    ],
  };
}

describe('protocol wallet (bch_signTransaction)', () => {
  it('signs only its own empty input, with a Schnorr signature over that input', async () => {
    const wallet = new ProtocolWallet(WALLET_KEY);
    const request = proposal();
    const { signedTransaction, signedTransactionHash } =
      await wallet.signTransaction({ ...request, userPrompt: 'Create escrow' });
    const tx = decodeTransaction(hexToBin(signedTransaction));
    if (typeof tx === 'string') throw new Error(tx);
    expect(tx.inputs[0]?.unlockingBytecode).toHaveLength(0);
    const unlocking = tx.inputs[1]?.unlockingBytecode ?? new Uint8Array();
    expect(unlocking).toHaveLength(1 + 65 + 1 + 33);
    expect(unlocking[65]).toBe(WALLET_SIGHASH);
    const serialization = generateSigningSerializationBCH(
      { transaction: request.transaction, sourceOutputs: request.sourceOutputs, inputIndex: 1 },
      { coveredBytecode: wallet.lockingBytecode, signingSerializationType: Uint8Array.of(WALLET_SIGHASH) });
    expect(secp256k1.verifySignatureSchnorr(unlocking.slice(1, 65), wallet.publicKey, hash256(serialization))).toBe(true);
    expect(signedTransactionHash).toHaveLength(64);
    expect(wallet.signed).toEqual([{ userPrompt: 'Create escrow', inputs: [1] }]);
  });

  it('refuses a transaction with none of its inputs, or with source outputs that do not match the inputs', async () => {
    const stranger = new ProtocolWallet(new Uint8Array(32).fill(0x33));
    await expect(stranger.signTransaction(proposal())).rejects.toThrow(WalletRefusal);
    const request = proposal();
    await expect(new ProtocolWallet(WALLET_KEY).signTransaction({ ...request, sourceOutputs: request.sourceOutputs.slice(1) }))
      .rejects.toThrow(/one source output per input/);
  });

  it('does not sign over an input that is already filled', async () => {
    const request = proposal();
    const filled = request.transaction.inputs.map((input, i) => i === 1 ? { ...input, unlockingBytecode: Uint8Array.of(0x51) } : input);
    await expect(new ProtocolWallet(WALLET_KEY).signTransaction({ ...request, transaction: { ...request.transaction, inputs: filled } }))
      .rejects.toThrow(/no input of this wallet/);
  });
});

describe('role key from a wallet message signature', () => {
  it('fills the message template from config and refuses multi-line or empty fields', () => {
    const message = roleKeyMessage(TEMPLATE, FIELDS);
    expect(message).toContain('jamin.example');
    expect(message).toContain('trade-1');
    expect(() => roleKeyMessage(TEMPLATE, { ...FIELDS, trade: 'a\nSite: other' })).toThrow(/one non-empty line/);
    expect(() => roleKeyMessage(TEMPLATE, { ...FIELDS, role: '' })).toThrow(/one non-empty line/);
    expect(() => roleKeyMessage('{site} {nonce}', FIELDS)).toThrow(/unknown field/);
  });

  it('recovers the signing key from a message signature', () => {
    const wallet = new ProtocolWallet(WALLET_KEY);
    expect(recoverSigner('hello', signMessage(WALLET_KEY, 'hello'))).toEqual(wallet.publicKey);
  });

  it('gives the same key for the same wallet and trade, and another key for another trade', async () => {
    const wallet = new ProtocolWallet(WALLET_KEY);
    const derive = async (trade: string): Promise<Uint8Array> => {
      const message = roleKeyMessage(TEMPLATE, { ...FIELDS, trade });
      return roleKeyFrom(message, await wallet.signMessage(message), wallet.pkh);
    };
    const first = await derive('trade-1');
    expect(await derive('trade-1')).toEqual(first);
    expect(await derive('trade-2')).not.toEqual(first);
    expect(first).not.toEqual(WALLET_KEY);
    expect(secp256k1.validatePrivateKey(first)).toBe(true);
  });

  it('refuses a signature made by another wallet', () => {
    const message = roleKeyMessage(TEMPLATE, FIELDS);
    const signature = signMessage(OTHER_KEY, message);
    expect(() => roleKeyFrom(message, signature, hash160(new ProtocolWallet(WALLET_KEY).publicKey)))
      .toThrow(/not signed by the connected wallet/);
  });
});
