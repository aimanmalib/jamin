// A lifecycle context on a network where coins are real: every party is an HD path of the project's test wallet,
// coins come from what the wallet holds, and time cannot be moved. The provider handed in is already behind the
// spending gate (src/budget/gate.ts), so each transaction made here is checked against the budget before it is sent.
import { TransactionBuilder, type NetworkProvider, type Output, type Utxo } from '@solidcash/solidcash';
import { lockOf, party, satsAt, type Ctx, type Party, type PartyName, type Step, type Terms } from './context.js';

/** The chain has not reached `until` (seconds, median time past) yet: run the rest later. */
export class WaitError extends Error {
  constructor(readonly until: bigint) {
    super(`waiting until ${new Date(Number(until) * 1000).toISOString()} (median time past)`);
    this.name = 'WaitError';
  }
}

/** The wallet holds no coin of the token the token branch trades. */
export class NoTokenError extends Error {
  constructor(readonly category: string, readonly wanted: bigint) {
    super(`the seller holds fewer than ${wanted} units of token ${category}`);
    this.name = 'NoTokenError';
  }
}

export interface WalletOptions {
  network: string;
  provider: NetworkProvider;
  keys: Record<PartyName, Uint8Array>;
  terms: Terms;
  tokenCategory: string;
  genesisCoinSats: bigint;
  partyFloatSats: bigint;
  feeRate: number;
  /** Parties topped up to `partyFloatSats` before the run (default: the buyer and the arbitrator). */
  floatParties?: Array<'buyer' | 'arbitrator'>;
}

/** Margin over the outputs a payment gathers, for the fee of a few inputs and outputs. */
const FEE_MARGIN = 3_000n;
const TOKEN_COIN_SATS = 1_000n;

function plain(coins: Utxo[]): Utxo[] {
  return coins.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : a.satoshis > b.satoshis ? -1 : 0));
}

/** Pays `outputs` from `from`'s plain coins, change back to `from`. Output 0 is the first of `outputs`. */
export async function pay(provider: NetworkProvider, from: Party, outputs: Output[], feeRate: number,
  extra: Utxo[] = []): Promise<string> {
  const need = outputs.reduce((a, o) => a + o.amount, 0n) + FEE_MARGIN;
  const chosen: Utxo[] = [];
  let have = 0n;
  for (const coin of plain(await provider.getUtxos(from.address))) {
    if (have >= need) break;
    chosen.push(coin);
    have += coin.satoshis;
  }
  if (have < need) throw new Error(`${from.address} holds ${have} sats, a payment needs ${need}`);
  const tx = new TransactionBuilder({ provider }).addInputs([...extra, ...chosen], from.signer.unlockP2PKH())
    .addOutputs(outputs).addBchChangeOutputIfNeeded({ to: from.address, feeRate });
  return (await tx.send()).txid;
}

/** Token coins of `category` (no NFT) held at `address`. */
async function tokenCoins(provider: NetworkProvider, address: string, category: string): Promise<Utxo[]> {
  return (await provider.getUtxos(address)).filter((u) => u.token?.category === category && u.token.nft === undefined);
}

/**
 * Moves every coin of `category` the other parties hold into one coin of the seller. All parties are paths of the
 * same test wallet, so each signs its own input; the token coins' satoshis pay the fee and the change goes to the
 * seller. Returns false when the wallet as a whole holds fewer than `wanted` units.
 */
export async function gatherTokens(provider: NetworkProvider, parties: Record<PartyName, Party>, category: string,
  wanted: bigint, feeRate: number): Promise<boolean> {
  const { seller } = parties;
  const inputs: Array<[Utxo, Party]> = [];
  for (const p of Object.values(parties)) {
    for (const coin of await tokenCoins(provider, p.address, category)) inputs.push([coin, p]);
  }
  const units = inputs.reduce((a, [c]) => a + (c.token?.amount ?? 0n), 0n);
  if (units < wanted) return false;
  const tx = new TransactionBuilder({ provider });
  for (const [coin, p] of inputs) tx.addInput(coin, p.signer.unlockP2PKH());
  const sats = inputs.reduce((a, [c]) => a + c.satoshis, 0n);
  if (sats < TOKEN_COIN_SATS + FEE_MARGIN) {
    const [fee] = plain(await provider.getUtxos(seller.address));
    if (!fee) throw new Error(`${seller.address} holds no plain coin for the token gathering fee`);
    tx.addInput(fee, seller.signer.unlockP2PKH());
  }
  tx.addOutput({ to: lockOf(seller.address), amount: TOKEN_COIN_SATS, token: { category, amount: units } })
    .addBchChangeOutputIfNeeded({ to: seller.address, feeRate });
  await tx.send();
  return true;
}

export interface WalletRun { ctx: Ctx; steps: Step[] }

export async function walletContext(o: WalletOptions): Promise<WalletRun> {
  const { provider } = o;
  const parties: Record<PartyName, Party> = {
    seller: party(o.keys.seller, provider), buyer: party(o.keys.buyer, provider),
    arbitrator: party(o.keys.arbitrator, provider), fees: party(o.keys.fees, provider),
    arbiterB: party(o.keys.arbiterB, provider), arbiterC: party(o.keys.arbiterC, provider),
  };
  const { seller } = parties;
  const steps: Step[] = [];

  // The buyer and the arbitrator pay their own transaction fees (and the buyer a dispute fee): top them up once.
  const topUps: Output[] = [];
  for (const p of o.floatParties ?? ['buyer', 'arbitrator'] as const) {
    const has = await satsAt(provider, parties[p].address);
    if (has * 2n < o.partyFloatSats) topUps.push({ to: lockOf(parties[p].address), amount: o.partyFloatSats - has });
  }
  if (topUps.length > 0) await pay(provider, seller, topUps, o.feeRate);

  const ctx: Ctx = {
    network: o.network, provider, parties, terms: o.terms,
    genesisCoin: async (p) => {
      const owner = parties[p];
      const ready = plain(await provider.getUtxos(owner.address))
        .find((u) => u.vout === 0 && u.satoshis >= o.genesisCoinSats);
      if (ready) return ready;
      const txid = await pay(provider, owner, [{ to: lockOf(owner.address), amount: o.genesisCoinSats }], o.feeRate);
      return { txid, vout: 0, satoshis: o.genesisCoinSats };
    },
    tokenCoin: async (amount) => {
      const category = o.tokenCategory;
      let coins = await tokenCoins(provider, seller.address, category);
      if (coins.reduce((a, u) => a + (u.token?.amount ?? 0n), 0n) < amount) {
        // Units left at other roles by earlier branches (the buyer's and the fee recipient's) come back first.
        if (!await gatherTokens(provider, parties, category, amount, o.feeRate)) throw new NoTokenError(category, amount);
        coins = await tokenCoins(provider, seller.address, category);
      }
      const exact = coins.find((u) => u.token?.amount === amount);
      if (exact) return { category, coin: exact };
      const bigger = coins.find((u) => (u.token?.amount ?? 0n) > amount);
      if (!bigger?.token) throw new NoTokenError(category, amount);
      // Split off exactly `amount`: the escrow's deposit takes one whole token coin.
      const lock = lockOf(seller.address);
      const txid = await pay(provider, seller, [
        { to: lock, amount: TOKEN_COIN_SATS, token: { category, amount } },
        { to: lock, amount: TOKEN_COIN_SATS, token: { category, amount: bigger.token.amount - amount } },
      ], o.feeRate, [bigger]);
      return { category, coin: { txid, vout: 0, satoshis: TOKEN_COIN_SATS, token: { category, amount } } };
    },
    waitUntil: async (timestamp) => {
      if (BigInt(await provider.getMedianTimePast()) < timestamp) throw new WaitError(timestamp);
    },
    record: (s) => { steps.push(s); },
    refused: [],
  };
  return { ctx, steps };
}
