// One finished escrow on the chain: the coins at each of its contract addresses, what every entry point does with
// them on a mirror (src/coins/paths.ts), and whether its event records can be swept back to the wallet.
import { binToHex, decodeTransaction, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import type { NetworkProvider, Utxo } from '@solidcash/solidcash';
import { resolveIdentity, type IdentityRecord } from '@solidcash/solidcash/bcmr';
import { party, type Party, type PartyName } from '../lifecycle/context.js';
import { classify, matured, spendableFrom, SWEPT_KINDS, totalsByKind, type ContractAddress, type ContractCoin, type KindTotal,
  type ListedCoin } from './classify.js';
import { addressesOf, attach, type Attached } from './escrows.js';
import { fillerAddress, fillerLock } from './filler.js';
import { burnIdentity, eventSweep, mirror, tryEntryPoints, verbatim, type EventCoin, type PathResult } from './paths.js';

export interface SurveyOptions {
  branch: string;
  address: string;
  /** Read from the chain; the contract and its parties attached to it. */
  attached: Attached;
  provider: NetworkProvider;
  keys: Record<PartyName, Uint8Array>;
  /** Transactions of the escrow's steps, with their block heights where known. */
  stepTxids: readonly string[];
  heights: ReadonlyMap<string, number>;
  walletLocks: ReadonlySet<string>;
  tip: number;
  medianTimePast: number;
  relativeBlocks: number;
  feeRate: number;
  mirrorFundingSats: bigint;
  /** Smallest owner coin an identity burn takes for its fee. */
  identityFeeCoinSats: bigint;
  /** Where swept event coins go. */
  sweepTo: string;
}

export interface Survey {
  branch: string;
  address: string;
  status: number;
  byKind: KindTotal[];
  coins: ContractCoin[];
  paths: PathResult[];
  eventSweep: { outcome: 'accepted' | 'refused' | 'no event coins'; error?: string; spendableFromBlock?: number;
    maturedNow: number };
  /** Event coins whose relative lock has passed, ready for a sweep on the chain. */
  ready: EventCoin[];
  events: EventCoin[];
  identityBurn: { outcome: 'accepted' | 'refused' | 'no active identity'; error?: string };
  /** The category's identity while it is active, ready for a burn on the chain. */
  identity?: IdentityRecord;
}

function addressOfLock(lock: Uint8Array): string | undefined {
  const a = lockingBytecodeToCashAddress({ bytecode: lock, prefix: 'bitcoincash', tokenSupport: true });
  return typeof a !== 'string' && 'address' in a ? a.address : undefined;
}

/** Locks the escrow's own transactions paid that are neither the wallet's nor a known contract address. */
async function otherLocks(provider: NetworkProvider, txids: readonly string[], known: ReadonlySet<string>,
  walletLocks: ReadonlySet<string>): Promise<Pick<ContractAddress, 'lock' | 'address'>[]> {
  const found = new Map<string, string>();
  for (const txid of txids) {
    const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(txid)));
    if (typeof tx === 'string') throw new Error(`${txid}: ${tx}`);
    for (const o of tx.outputs) {
      const lock = binToHex(o.lockingBytecode);
      if (known.has(lock) || walletLocks.has(lock) || o.valueSatoshis === 0n) continue;
      const a = addressOfLock(o.lockingBytecode);
      if (a !== undefined) found.set(lock, a);
    }
  }
  return [...found].map(([lock, address]) => ({ lock, address }));
}

export async function surveyEscrow(o: SurveyOptions): Promise<Survey> {
  const known = addressesOf(o.attached);
  const found = await resolveIdentity(o.provider, o.attached.sc.categoryId);
  const identity = found?.status === 'active' ? found : undefined;
  const identityAddress = identity && addressOfLock(identity.lockingBytecode);
  if (identity && identityAddress) {
    known.push({ lock: binToHex(identity.lockingBytecode), address: identityAddress, kind: 'identity' });
  }
  known.push({ lock: binToHex(fillerLock()), address: fillerAddress(), kind: 'filler', shared: true });
  const extra = await otherLocks(o.provider, o.stepTxids, new Set(known.map((a) => a.lock)), o.walletLocks);
  const utxos = new Map<string, { address: string; utxo: Utxo }>();
  const listed = new Map<string, ListedCoin[]>();
  const lookups: (Pick<ContractAddress, 'lock' | 'address'> & Partial<ContractAddress>)[] = [...known, ...extra];
  for (const ad of lookups) {
    const list = await o.provider.getUtxos(ad.address);
    // An address no part of this contract names may hold other people's coins: keep the escrow's own.
    const ours = ad.kind !== undefined && ad.shared !== true ? list : list.filter((u) => o.stepTxids.includes(u.txid));
    for (const u of ours) utxos.set(`${u.txid}:${u.vout}`, { address: ad.address, utxo: u });
    listed.set(ad.lock, ours.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: Number(u.satoshis),
      ...(u.token?.amount ? { tokenAmount: Number(u.token.amount) } : {}),
      ...(o.heights.has(u.txid) ? { height: o.heights.get(u.txid) as number } : {}) })));
  }
  const coins = classify(o.branch, known, listed);
  const state = await o.attached.sc.getState() as { status: bigint | number;
    terms: { amount: bigint; fee: bigint; disputeFee: bigint } };

  // The same contract on a mirror of its coins; branch W keeps its seller's role key.
  const parties0 = o.attached.parties;
  const payers = [...new Set(Object.values(parties0).map((p) => p.address))];
  const m = await mirror([...utxos.values()], payers, o.medianTimePast, o.mirrorFundingSats, o.provider);
  const onMirror = Object.fromEntries(Object.entries(o.keys).map(([n, k]) => [n, party(k, m)])) as Record<PartyName, Party>;
  onMirror.seller = { ...onMirror.seller, sig: parties0.seller.sig, ecdsa: parties0.seller.ecdsa,
    publicKey: parties0.seller.publicKey };
  const mirrored = await attach(o.address, onMirror, m, o.attached.category);
  const paths = await tryEntryPoints(mirrored.sc, onMirror, state.terms, o.attached.category);

  const eventsOf = (cs: readonly ContractCoin[]): EventCoin[] => cs.filter((c) => SWEPT_KINDS.includes(c.kind))
    .map((c) => ({ utxo: (utxos.get(`${c.txid}:${c.vout}`) as { utxo: Utxo }).utxo,
      ...(c.kind === 'event' ? { event: c.event ?? '' } : {}) }));
  const events = eventsOf(coins);
  const heights = coins.filter((c) => SWEPT_KINDS.includes(c.kind) && c.height !== undefined).map((c) => c.height as number);
  const ready = eventsOf(matured(coins, o.tip, o.relativeBlocks));
  let sweep: Survey['eventSweep'] = { outcome: 'no event coins', maturedNow: ready.length };
  if (events.length > 0) {
    const from = heights.length ? { spendableFromBlock: spendableFrom(Math.min(...heights), o.relativeBlocks) } : {};
    try {
      await eventSweep(mirrored.sc, m, events, o.sweepTo, o.feeRate, o.relativeBlocks).send();
      sweep = { outcome: 'accepted', ...from, maturedNow: ready.length };
    } catch (e) {
      sweep = { outcome: 'refused', error: verbatim(e), ...from, maturedNow: ready.length };
    }
  }
  let identityBurn: Survey['identityBurn'] = { outcome: 'no active identity' };
  if (identity) {
    try {
      await burnIdentity(m, identity, onMirror.seller, o.identityFeeCoinSats);
      identityBurn = { outcome: 'accepted' };
    } catch (e) {
      identityBurn = { outcome: 'refused', error: verbatim(e) };
    }
  }
  return { identityBurn, ...(identity ? { identity } : {}), branch: o.branch, address: o.address, status: Number(state.status), byKind: totalsByKind(coins), coins,
    paths, eventSweep: sweep, ready, events };
}
