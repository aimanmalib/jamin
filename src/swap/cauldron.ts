// Buying a small amount of a token from Cauldron liquidity pools, for the mainnet token escrow (docs/decisions/0012).
// Trade maths and the transaction come from @cashlab/cauldron (ISC). The pool list comes from a public indexer, so it
// is data, not trust: every pool is checked against the transaction that created it before it is used, and the
// finished transaction is verified by the library's script VM before anything is broadcast.
import { binToHex, decodeTransaction, hashTransactionUiOrder, hexToBin } from '@bitauth/libauth';
import ExchangeLab from '@cashlab/cauldron/exchange-lab.js';
import type { PoolV0 } from '@cashlab/cauldron/types.js';
import { PayoutAmountRuleType, SpendableCoinType, type SpendableCoin } from '@cashlab/common/types.js';
import type { Utxo } from '@solidcash/solidcash';

/** One entry of the indexer's active pool list (only the fields used here). */
export interface IndexedPool {
  owner_pkh: string;
  sats: number;
  token_id: string;
  tokens: number;
  tx_pos: number;
  txid: string;
}

export function poolsFromIndexer(body: unknown, category: string): IndexedPool[] {
  const list = (body as { active?: unknown }).active;
  if (!Array.isArray(list)) throw new Error('the indexer answer has no active pool list');
  return (list as IndexedPool[]).filter((p) => p.token_id === category && /^[0-9a-f]{40}$/.test(p.owner_pkh)
    && /^[0-9a-f]{64}$/.test(p.txid) && Number.isInteger(p.tx_pos) && p.sats > 0 && p.tokens > 0);
}

/**
 * Pools whose output, read from the raw transaction that created it, has exactly the Cauldron locking bytecode for
 * its owner and the satoshis and token amount the indexer reported. Pools that do not match are dropped.
 */
export async function verifiedPools(exlab: ExchangeLab, indexed: IndexedPool[],
  rawTx: (txid: string) => Promise<string>): Promise<PoolV0[]> {
  const pools: PoolV0[] = [];
  for (const p of indexed) {
    const parameters = { withdraw_pubkey_hash: hexToBin(p.owner_pkh) };
    const lock = exlab.generatePoolV0LockingBytecode(parameters);
    const tx = decodeTransaction(hexToBin(await rawTx(p.txid)));
    if (typeof tx === 'string') continue;
    const out = tx.outputs[p.tx_pos];
    if (!out || binToHex(out.lockingBytecode) !== binToHex(lock) || out.valueSatoshis !== BigInt(p.sats)) continue;
    if (out.token?.category === undefined || binToHex(out.token.category) !== p.token_id) continue;
    if (out.token.amount !== BigInt(p.tokens) || out.token.nft) continue;
    pools.push({
      version: '0', parameters, outpoint: { txhash: hexToBin(p.txid), index: p.tx_pos },
      output: { locking_bytecode: lock, amount: BigInt(p.sats), token: { token_id: p.token_id, amount: BigInt(p.tokens) } },
    });
  }
  return pools;
}

export interface PurchaseInput {
  pools: PoolV0[];
  category: string;
  units: bigint;
  /** The buyer's plain BCH coins (token coins are ignored). */
  coins: Utxo[];
  privateKey: Uint8Array;
  /** P2PKH locking bytecode of the buyer: receives the tokens and the BCH change. */
  lock: Uint8Array;
  feeRate: bigint;
  /** Refuse when the pools ask more satoshis than this for the tokens (trade fee included). */
  maxSupplySats: bigint;
}

export interface Purchase {
  txHex: string;
  txid: string;
  units: bigint;
  /** Satoshis paid into the pools, trade fee included. */
  supplySats: bigint;
  tradeFeeSats: bigint;
  minerFeeSats: bigint;
}

/** Builds and verifies the trade transaction; it does not broadcast. */
export function buildPurchase(exlab: ExchangeLab, o: PurchaseInput): Purchase {
  if (o.units <= 0n) throw new Error('units to buy must be positive');
  const trade = exlab.constructTradeBestRateForTargetDemand('BCH', o.category, o.units, o.pools, o.feeRate);
  const { supply, trade_fee: tradeFee, demand } = trade.summary;
  if (supply > o.maxSupplySats) {
    throw new Error(`the pools ask ${supply} sats for ${demand} units, more than the ${o.maxSupplySats} sat limit`);
  }
  const coins: SpendableCoin[] = o.coins.filter((u) => !u.token).map((u) => ({
    type: SpendableCoinType.P2PKH, key: o.privateKey,
    outpoint: { txhash: hexToBin(u.txid), index: u.vout },
    output: { locking_bytecode: o.lock, amount: u.satoshis },
  }));
  const result = exlab.createTradeTx(trade.entries, coins, [
    { type: PayoutAmountRuleType.FIXED, locking_bytecode: o.lock, amount: -1n,
      token: { token_id: o.category, amount: demand } },
    { type: PayoutAmountRuleType.CHANGE, locking_bytecode: o.lock },
  ], null, o.feeRate);
  exlab.verifyTradeTx(result);
  if (result.token_burns.length > 0) throw new Error('the trade transaction would burn tokens; refused');
  const txid = binToHex(hashTransactionUiOrder(result.txbin));
  return { txHex: binToHex(result.txbin), txid, units: demand, supplySats: supply, tradeFeeSats: tradeFee,
    minerFeeSats: result.txfee };
}
