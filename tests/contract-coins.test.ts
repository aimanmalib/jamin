import { describe, expect, it } from 'vitest';
import type { NetworkProvider, Utxo } from '@solidcash/solidcash';
import { classify, matured, spendableFrom, totalsByKind, type ContractAddress, type ListedCoin } from '../src/coins/classify.js';
import { escrowRows, minerFee, reconcile, type TxFlow } from '../src/coins/account.js';
import { headerTime, medianTimePast } from '../src/coins/escrows.js';
import { feeCoin, verbatim } from '../src/coins/paths.js';

const tx = (n: number): string => n.toString(16).padStart(64, '0');

const ADDRESSES: ContractAddress[] = [
  { lock: 'aa01', address: 'master', kind: 'master' },
  { lock: 'aa02', address: 'data', kind: 'data' },
  { lock: 'aa03', address: 'sats', kind: 'satoshiContainer' },
  { lock: 'aa04', address: 'released', kind: 'event', event: 'Released' },
  { lock: 'aa05', address: 'identity', kind: 'identity' },
];

describe('classify', () => {
  const listed = new Map<string, ListedCoin[]>([
    ['aa04', [{ txid: tx(9), vout: 6, satoshis: 1200, height: 100 }]],
    ['aa01', [{ txid: tx(9), vout: 0, satoshis: 1200 }]],
    // The same coin listed again under the token-aware form of an address.
    ['aa01-again', [{ txid: tx(9), vout: 0, satoshis: 1200 }]],
    ['aa02', [{ txid: tx(9), vout: 1, satoshis: 1200 }, { txid: tx(9), vout: 2, satoshis: 1200 }]],
    ['aa03', [{ txid: tx(9), vout: 3, satoshis: 1000 }]],
    ['bb99', [{ txid: tx(4), vout: 3, satoshis: 576 }]],
    ['aa05', [{ txid: tx(1), vout: 0, satoshis: 756 }]],
  ]);
  const coins = classify('A', ADDRESSES, listed);

  it('names each coin after the address it sits at and counts a coin listed twice once', () => {
    expect(coins.map((c) => c.kind)).toEqual(['master', 'data', 'data', 'satoshiContainer', 'event', 'identity', 'other']);
    expect(coins.find((c) => c.kind === 'event')?.event).toBe('Released');
    expect(coins.every((c) => c.branch === 'A')).toBe(true);
  });

  it('totals satoshis and token units by kind', () => {
    expect(totalsByKind(coins)).toEqual([
      { kind: 'master', coins: 1, satoshis: 1200, tokenAmount: 0 },
      { kind: 'data', coins: 2, satoshis: 2400, tokenAmount: 0 },
      { kind: 'satoshiContainer', coins: 1, satoshis: 1000, tokenAmount: 0 },
      { kind: 'event', coins: 1, satoshis: 1200, tokenAmount: 0 },
      { kind: 'identity', coins: 1, satoshis: 756, tokenAmount: 0 },
      { kind: 'other', coins: 1, satoshis: 576, tokenAmount: 0 },
    ]);
  });

  it('lets an event coin go once its relative lock has passed, and not a block earlier', () => {
    expect(spendableFrom(100, 144)).toBe(244);
    expect(matured(coins, 242, 144)).toEqual([]);
    expect(matured(coins, 243, 144).map((c) => c.vout)).toEqual([6]);
  });
});

describe('wallet accounting', () => {
  const flows: TxFlow[] = [
    // Funding from someone else: their inputs, our output.
    { txid: tx(1), walletIn: 0, walletOut: 100_000, otherIn: 500_000, otherOut: 399_800 },
    // A swap: 10,000 to a pool, 300 fee.
    { txid: tx(2), walletIn: 50_000, walletOut: 39_700, otherIn: 1_000_000, otherOut: 1_010_000 },
    // An escrow: create (deposit 4,000, fee 500), release (pays 2,000 back, fee 600), identity burn (756 back, fee 678).
    { txid: tx(3), branch: 'A', walletIn: 20_000, walletOut: 15_500, otherIn: 0, otherOut: 4_000 },
    { txid: tx(4), branch: 'A', walletIn: 3_000, walletOut: 4_400, otherIn: 4_000, otherOut: 2_000 },
    { txid: tx(5), branch: 'A', walletIn: 1_000, walletOut: 1_078, otherIn: 756, otherOut: 0 },
  ];

  it('gives each escrow what went in, what came out, its fees and what stays', () => {
    expect(minerFee(flows[3] as TxFlow)).toBe(600);
    expect(escrowRows(flows)).toEqual([
      { branch: 'A', transactions: 3, deposited: 4_000, paidOut: 2_756, minerFees: 1_778, locked: 1_244 },
    ]);
  });

  it('accounts for every satoshi of the funding, and names what does not add up', () => {
    const walletNow = 100_000 - 10_000 - 300 - 1_778 - 1_244;
    expect(reconcile(flows, walletNow)).toEqual({ fundingIn: 100_000, paidElsewhere: 10_000, minerFees: 2_078,
      locked: 1_244, walletNow, unexplained: 0 });
    expect(reconcile(flows, walletNow - 5).unexplained).toBe(5);
  });
});

describe('branch W search helpers', () => {
  it('reads a block header time and takes the median of eleven', () => {
    const header = new Uint8Array(80);
    header.set([0x5b, 0x4c, 0xfc, 0x6a], 68);
    expect(headerTime(Buffer.from(header).toString('hex'))).toBe(0x6afc4c5b);
    const times = new Map(Array.from({ length: 11 }, (_, i) => [100 + i, [9, 1, 8, 2, 7, 3, 6, 4, 5, 10, 11][i] as number]));
    expect(medianTimePast(times, 110)).toBe(6);
    expect(() => medianTimePast(times, 111)).toThrow(/no block time for 111/);
  });
});

describe('fee coin and error text', () => {
  const coin = (vout: number, satoshis: bigint, token = false): Utxo => ({ txid: tx(vout + 10), vout, satoshis,
    ...(token ? { token: { category: tx(1), amount: 1n } } : {}) });
  const provider = (coins: Utxo[]): NetworkProvider => ({ getUtxos: async () => coins }) as unknown as NetworkProvider;

  it('takes the smallest plain coin big enough, an output-0 coin only when nothing else will do', async () => {
    expect((await feeCoin(provider([coin(0, 1_500n), coin(2, 9_000n), coin(1, 2_000n), coin(3, 900n), coin(4, 1_100n, true)]),
      'x', 1_000n))?.vout).toBe(1);
    expect((await feeCoin(provider([coin(0, 1_500n), coin(3, 900n)]), 'x', 1_000n))?.vout).toBe(0);
    expect(await feeCoin(provider([coin(3, 900n)]), 'x', 1_000n)).toBeUndefined();
  });

  it('keeps a server reply on one line and drops links', () => {
    expect(verbatim(new Error('the transaction was rejected by network rules.\n\nnon-BIP68-final (code 64)\n')))
      .toBe('the transaction was rejected by network rules. non-BIP68-final (code 64)');
    const named = new Error('failed\nsee https://ide.bitauth.com/import-template/abc for details');
    named.name = 'FailedTransactionError';
    expect(verbatim(named)).toBe('FailedTransactionError: failed see <url> for details');
  });
});
