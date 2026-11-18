// Branch X (decision 0014): the seller trades on mainnet from a third-party wallet through the "Wallet" tab. The
// project's test wallet takes the other parts: it funds the third-party wallet once, through the spending gate, and
// its buyer key marks the trade as paid. The steps are recorded with the wallet's name and version.
import { hexToBin } from '@bitauth/libauth';
import { TransactionBuilder, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { sitsAt } from '../coins/escrows.js';
import { loadArtifact, lockOf, type Party, type Step } from './context.js';

/** Plain coins of `from`, largest first. */
async function plainCoins(provider: NetworkProvider, address: string): Promise<Utxo[]> {
  return (await provider.getUtxos(address)).filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
}

/**
 * Pays `amount` to `to` as output 0 (a contract's token genesis spends an output 0), from the plain coins of
 * `payers` in order until they cover it; change goes to the first payer. Returns the txid.
 */
export async function fundWallet(provider: NetworkProvider, payers: Party[], to: string, amount: bigint,
  feeRate: number): Promise<string> {
  const [first] = payers;
  if (first === undefined) throw new Error('no payer');
  let tx = new TransactionBuilder({ provider });
  let taken = 0n;
  for (const p of payers) {
    if (taken >= amount + 2_000n) break;
    const coins = await plainCoins(provider, p.address);
    if (coins.length === 0) continue;
    tx = tx.addInputs(coins, p.signer.unlockP2PKH());
    taken += coins.reduce((a, u) => a + u.satoshis, 0n);
  }
  if (taken < amount + 1_000n) throw new Error(`the payers hold ${taken} sat, ${amount} needed plus the fee`);
  tx = tx.addOutputs([{ to: lockOf(to), amount }]).addBchChangeOutputIfNeeded({ to: first.address, feeRate });
  return (await tx.send()).txid;
}

export interface EscrowKeys {
  seller: Uint8Array;
  buyer: Uint8Array;
  panel: readonly Uint8Array[];
  feeRecipientPkh: Uint8Array;
}

/** The escrow at `address` with the parameters the page used; throws when they do not give that address. */
export async function attachEscrow(provider: NetworkProvider, address: string, k: EscrowKeys): Promise<StatefulContract> {
  const sc = await StatefulContract.at(address, loadArtifact('JaminEscrow'), provider,
    { constructorArgs: [k.seller, k.buyer, ...k.panel, k.feeRecipientPkh] as never }) as unknown as StatefulContract;
  if (!sitsAt(sc, address)) throw new Error(`the keys do not give the escrow ${address}`);
  return sc;
}

export async function buyerMarksPaid(sc: StatefulContract, buyer: Party): Promise<string> {
  const fn = sc.connect(buyer.signer).call.markAsPaid;
  if (fn === undefined) throw new Error('contract has no entry point markAsPaid');
  return (await fn(buyer.sig).send()).txid;
}

/** Steps of branch X in order; the seller's are signed in `wallet`. */
export function branchXSteps(branch: string, escrow: string, wallet: string,
  seller: { createEscrow: string; fund: string; release: string }, markAsPaid: string): Step[] {
  const signed = { signer: 'wallet' as const, wallet };
  return [
    { branch, step: 'createEscrow', txid: seller.createEscrow, escrow, ...signed },
    { branch, step: 'fund', txid: seller.fund, ...signed },
    { branch, step: 'markAsPaid', txid: markAsPaid },
    { branch, step: 'release', txid: seller.release, ...signed },
  ];
}

export function keysFrom(hex: { seller: string; buyer: string; panel: string[]; feeRecipientPkh: string }): EscrowKeys {
  return { seller: hexToBin(hex.seller), buyer: hexToBin(hex.buyer), panel: hex.panel.map(hexToBin),
    feeRecipientPkh: hexToBin(hex.feeRecipientPkh) };
}
