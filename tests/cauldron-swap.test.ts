// The Cauldron token purchase, offline: indexer entries are filtered, each pool is checked against the transaction
// that created it, and the purchase transaction pays the asked units to the buyer, passes the library's script VM
// check and is refused when the pools ask more than the limit. Keys come from the public BIP39 test phrase.
import { decodeTransaction, encodeTransaction, hexToBin, type Transaction } from '@bitauth/libauth';
import ExchangeLab from '@cashlab/cauldron/exchange-lab.js';
import { describe, expect, it } from 'vitest';
import { lockOf } from '../src/lifecycle/context.js';
import { buildPurchase, poolsFromIndexer, verifiedPools, type IndexedPool } from '../src/swap/cauldron.js';
import { deriveKey } from '../src/wallet/keys.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const CATEGORY = 'ab'.repeat(32);
const OWNER = '11'.repeat(20);
const exlab = new ExchangeLab();
const buyer = deriveKey(PHRASE, "m/44'/145'/0'/0/0");

function poolTx(sats: bigint, tokens: bigint, owner = OWNER): string {
  const lock = exlab.generatePoolV0LockingBytecode({ withdraw_pubkey_hash: hexToBin(owner) });
  const tx: Transaction = {
    version: 2, locktime: 0,
    inputs: [{ outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() }],
    outputs: [{ lockingBytecode: lock, valueSatoshis: sats, token: { category: hexToBin(CATEGORY), amount: tokens } }],
  };
  return Buffer.from(encodeTransaction(tx)).toString('hex');
}

const RAW: Record<string, string> = { ['01'.repeat(32)]: poolTx(48_000_000n, 10_000n) };
const entry: IndexedPool = { owner_pkh: OWNER, sats: 48_000_000, token_id: CATEGORY, tokens: 10_000, tx_pos: 0,
  txid: '01'.repeat(32) };

async function pools(list: IndexedPool[]) {
  return verifiedPools(exlab, list, async (txid) => {
    const raw = RAW[txid];
    if (!raw) throw new Error(`no tx ${txid}`);
    return raw;
  });
}

describe('cauldron purchase', () => {
  it('keeps only well-formed indexer entries of the category', () => {
    const body = { active: [entry, { ...entry, token_id: 'cd'.repeat(32) }, { ...entry, owner_pkh: 'zz' }] };
    expect(poolsFromIndexer(body, CATEGORY)).toEqual([entry]);
    expect(() => poolsFromIndexer({}, CATEGORY)).toThrow(/no active pool list/);
  });

  it('drops a pool whose on-chain output differs from the indexer entry', async () => {
    expect(await pools([entry])).toHaveLength(1);
    expect(await pools([{ ...entry, sats: 47_000_000 }])).toHaveLength(0);
    expect(await pools([{ ...entry, tokens: 9_999 }])).toHaveLength(0);
    expect(await pools([{ ...entry, owner_pkh: '22'.repeat(20) }])).toHaveLength(0);
  });

  it('builds a verified transaction paying the units to the buyer', async () => {
    const lock = lockOf(buyer.address);
    const p = buildPurchase(exlab, { pools: await pools([entry]), category: CATEGORY, units: 12n,
      coins: [{ txid: '02'.repeat(32), vout: 1, satoshis: 200_000n }], privateKey: buyer.privateKey, lock,
      feeRate: 1n, maxSupplySats: 80_000n });
    expect(p.units).toBe(12n);
    expect(p.supplySats).toBeGreaterThan(12n * 4_800n);
    expect(p.tradeFeeSats).toBeGreaterThan(0n);
    expect(p.txid).toMatch(/^[0-9a-f]{64}$/);
    const tx = decodeTransaction(hexToBin(p.txHex));
    if (typeof tx === 'string') throw new Error(tx);
    const toBuyer = tx.outputs.filter((o) => Buffer.from(o.lockingBytecode).equals(Buffer.from(lock)));
    expect(toBuyer.map((o) => o.token?.amount ?? 0n).reduce((a, b) => a + b, 0n)).toBe(12n);
  });

  it('refuses when the pools ask more than the limit', async () => {
    expect(() => buildPurchase(exlab, { pools: [], category: CATEGORY, units: 12n, coins: [], privateKey: buyer.privateKey,
      lock: lockOf(buyer.address), feeRate: 1n, maxSupplySats: 1n })).toThrow();
    const verified = await pools([entry]);
    expect(() => buildPurchase(exlab, { pools: verified, category: CATEGORY, units: 12n,
      coins: [{ txid: '02'.repeat(32), vout: 1, satoshis: 200_000n }], privateKey: buyer.privateKey,
      lock: lockOf(buyer.address), feeRate: 1n, maxSupplySats: 10_000n })).toThrow(/more than the 10000 sat limit/);
  });
});
