// The keyless relayer's checks (docs/decisions/0019) on a hand-built transaction. The escrow case, with a real
// signature and covenant, is in test/relay.test.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, encodeTransaction, hashTransaction, type TransactionBCH } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../src/config.js';
import { RelayRefused, checkRelay, intentFor, relay } from '../src/relay/relay.js';

const ESCROW = 'ab'.repeat(32);
const FEE_COIN = 'cd'.repeat(32);
const CATEGORY = Uint8Array.from({ length: 32 }, (_, i) => i);
const lock = (b: number): Uint8Array => Uint8Array.of(0x76, 0xa9, 0x14, ...new Uint8Array(20).fill(b), 0x88, 0xac);
const hexToBytes = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

const TX: TransactionBCH = {
  version: 2,
  locktime: 0,
  inputs: [
    { outpointTransactionHash: hexToBytes(ESCROW), outpointIndex: 1, sequenceNumber: 0, unlockingBytecode: Uint8Array.of(0x51) },
    { outpointTransactionHash: hexToBytes(FEE_COIN), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of(0x51) },
  ],
  outputs: [
    { lockingBytecode: lock(1), valueSatoshis: 20_000n },
    { lockingBytecode: lock(2), valueSatoshis: 1_000n, token: { category: CATEGORY, amount: 7n } },
  ],
};
const hexOf = (tx: TransactionBCH): string => binToHex(encodeTransaction(tx));
const HEX = hexOf(TX);
const INTENT = intentFor(HEX, [{ txid: ESCROW, vout: 1 }]);
const withOutputs = (outputs: TransactionBCH['outputs']): string => hexOf({ ...TX, outputs });
const [OUT0, OUT1] = TX.outputs as [TransactionBCH['outputs'][0], TransactionBCH['outputs'][0]];

describe('relay checks', () => {
  it('accepts the transaction the intent was written for', () => {
    expect(checkRelay(HEX, INTENT)).toEqual([]);
  });

  it.each([
    ['another address', withOutputs([{ ...OUT0, lockingBytecode: lock(9) }, OUT1]), /output 0 differs/],
    ['fewer satoshis', withOutputs([{ ...OUT0, valueSatoshis: 19_999n }, OUT1]), /output 0 differs/],
    ['fewer token units', withOutputs([OUT0, { ...OUT1, token: { category: CATEGORY, amount: 6n } }]), /output 1 differs/],
    ['tokens taken off', withOutputs([OUT0, { lockingBytecode: OUT1.lockingBytecode, valueSatoshis: 1_000n }]), /output 1 differs/],
    ['an extra output', withOutputs([OUT0, OUT1, { lockingBytecode: lock(9), valueSatoshis: 546n }]), /has 3 outputs, the intent 2/],
    ['outputs swapped', withOutputs([OUT1, OUT0]), /output 0 differs/],
  ])('refuses a transaction with %s', (_name, hex, reason) => {
    expect(checkRelay(hex, INTENT).join('; ')).toMatch(reason);
  });

  it('refuses a transaction that does not spend the escrow coin the intent names', () => {
    expect(checkRelay(HEX, { ...INTENT, spends: [{ txid: ESCROW, vout: 0 }] })).toEqual([`does not spend ${ESCROW}:0`]);
    expect(checkRelay(HEX, { ...INTENT, spends: [] })).toEqual(['the intent names no coin to spend']);
  });

  it('refuses input that is not a transaction', () => {
    expect(checkRelay('zz', INTENT)).toEqual(['not a hex transaction']);
    expect(checkRelay('00', INTENT)[0]).toMatch(/cannot decode/);
  });
});

describe('relay', () => {
  it('sends the bytes unchanged and returns their txid', async () => {
    const sent: string[] = [];
    const txid = await relay(HEX, INTENT, (h) => { sent.push(h); return Promise.resolve(hashTransaction(encodeTransaction(TX))); });
    expect(sent).toEqual([HEX]);
    expect(txid).toBe(hashTransaction(encodeTransaction(TX)));
  });

  it('sends nothing when the transaction differs from the intent', async () => {
    let sends = 0;
    const bad = withOutputs([{ ...OUT0, lockingBytecode: lock(9) }, OUT1]);
    await expect(relay(bad, INTENT, () => { sends += 1; return Promise.resolve(''); })).rejects.toThrow(RelayRefused);
    expect(sends).toBe(0);
  });

  it('refuses a send that reports another txid than the signed transaction', async () => {
    await expect(relay(HEX, INTENT, () => Promise.resolve('00'.repeat(32)))).rejects.toThrow(/the network reported/);
  });

  it('holds no key: the relay module imports no signer, key, phrase or environment file', () => {
    const dir = join(repoRoot, 'src/relay');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/privateKey|SignatureTemplate|Signer|secp256k1|sign[A-Z]\w*\(|mnemonic|deriveKey|env-file|process\.env/i);
    }
  });
});
