import { encodeTransaction } from '@bitauth/libauth';
import type { NetworkProvider } from '@solidcash/solidcash';
import { describe, expect, it } from 'vitest';
import { tradeFee } from '../src/lifecycle/branches.js';
import { measure } from '../src/lifecycle/inspect.js';
import { regtestRpc } from '../src/lifecycle/regtest.js';

describe('tradeFee', () => {
  it('takes basis points of the amount and raises it to the floor', () => {
    expect(tradeFee(200_000n, 30n, 546n)).toBe(600n);
    expect(tradeFee(20_000n, 30n, 546n)).toBe(546n);
    expect(tradeFee(200n, 30n, 1n)).toBe(1n);
    expect(tradeFee(1_000_000n, 0n, 0n)).toBe(0n);
  });
});

describe('measure', () => {
  it('reads transaction size, counts and the largest unlocking script', async () => {
    const input = (n: number) => ({ outpointIndex: 0, outpointTransactionHash: new Uint8Array(32),
      sequenceNumber: 0, unlockingBytecode: new Uint8Array(n) });
    const raw = encodeTransaction({ version: 2, locktime: 0, inputs: [input(10), input(300)],
      outputs: [{ lockingBytecode: new Uint8Array(25), valueSatoshis: 1_000n }] });
    const hex = Buffer.from(raw).toString('hex');
    const provider = { getRawTransaction: async () => hex } as unknown as NetworkProvider;
    const m = await measure(provider, { branch: 'A', step: 'fund', txid: 'ab'.repeat(32) });
    expect(m).toMatchObject({ txBytes: raw.length, inputs: 2, outputs: 1, maxUnlockingBytes: 300, step: 'fund' });
  });
});

describe('regtestRpc', () => {
  it('sends a basic-auth JSON-RPC call and surfaces node errors', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const replies = [{ result: 7, error: null }, { result: null, error: { message: 'Method not found' } }];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { json: async () => replies.shift() } as Response;
    }) as typeof fetch;
    try {
      const rpc = regtestRpc('http://127.0.0.1:18443', 'u', 'p');
      expect(await rpc('getblockcount')).toBe(7);
      await expect(rpc('nope')).rejects.toThrow('nope: Method not found');
      expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('u:p')}`);
      expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ method: 'getblockcount', params: [] });
    } finally {
      globalThis.fetch = original;
    }
  });
});
