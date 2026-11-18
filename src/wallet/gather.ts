// Moves plain coins from the other role addresses of the test wallet to the seller, so a mainnet run can start when
// the wallet as a whole holds enough but the seller address alone does not (decision 0016). The buyer and the
// arbitrator keep what they need for their own fees; token coins are never touched. Every satoshi stays in the
// wallet: the transaction goes through the spending gate, which counts only its network fee.
import { TransactionBuilder, type NetworkProvider, type Output, type Utxo } from '@solidcash/solidcash';
import { lockOf, type Party, type PartyName } from '../lifecycle/context.js';

/** Smallest output the network relays. */
export const DUST_SATS = 546n;

export interface Holding { name: PartyName; coins: Utxo[] }

export interface GatherPlan {
  /** Coins taken, with the party that signs for them. */
  inputs: { name: PartyName; coins: Utxo[] }[];
  /** What a party gets back in the same transaction so it keeps its floor. */
  keeps: { name: PartyName; amount: bigint }[];
  /** Satoshis taken from the inputs before the change to the keepers and the fee. */
  taken: bigint;
}

/**
 * Which coins to move. A party with a floor in `keep` gives only what it holds above that floor, and nothing when
 * the rest would be dust; a party without a floor gives all its plain coins. The seller is never an input.
 */
export function gatherPlan(holdings: Holding[], keep: Partial<Record<PartyName, bigint>>): GatherPlan {
  const plan: GatherPlan = { inputs: [], keeps: [], taken: 0n };
  for (const h of holdings) {
    if (h.name === 'seller') continue;
    const coins = h.coins.filter((u) => !u.token);
    const total = coins.reduce((a, u) => a + u.satoshis, 0n);
    const floor = keep[h.name] ?? 0n;
    if (total === 0n || total - floor < DUST_SATS) continue;
    plan.inputs.push({ name: h.name, coins });
    plan.taken += total;
    if (floor > 0n) plan.keeps.push({ name: h.name, amount: floor });
  }
  return plan;
}

/** Sends the plan in one transaction; the seller gets the rest after the fee. Returns the txid, or none to move. */
export async function gather(provider: NetworkProvider, parties: Record<PartyName, Party>,
  keep: Partial<Record<PartyName, bigint>>, feeRate: number): Promise<{ txid?: string; plan: GatherPlan }> {
  const holdings: Holding[] = [];
  for (const name of Object.keys(parties) as PartyName[]) {
    holdings.push({ name, coins: await provider.getUtxos(parties[name].address) });
  }
  const plan = gatherPlan(holdings, keep);
  if (plan.inputs.length === 0) return { plan };
  let tx = new TransactionBuilder({ provider });
  for (const i of plan.inputs) tx = tx.addInputs(i.coins, parties[i.name].signer.unlockP2PKH());
  const outputs: Output[] = plan.keeps.map((k) => ({ to: lockOf(parties[k.name].address), amount: k.amount }));
  if (outputs.length > 0) tx = tx.addOutputs(outputs);
  tx = tx.addBchChangeOutputIfNeeded({ to: parties.seller.address, feeRate });
  return { txid: (await tx.send()).txid, plan };
}
