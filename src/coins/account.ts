// Where the test wallet's satoshis went: each transaction in the wallet's history as flows between the wallet, the
// escrow contracts and everyone else, then one row per escrow and a check that the whole adds up. Pure; the
// transactions are read in scripts/contract-coins.ts.
import { sum } from './classify.js';

/** One transaction, in satoshis, split by whose coins its inputs spend and whose locks its outputs pay. */
export interface TxFlow {
  txid: string;
  /** The escrow branch whose step this transaction is; its non-wallet inputs and outputs are that contract's. */
  branch?: string;
  walletIn: number;
  walletOut: number;
  otherIn: number;
  otherOut: number;
}

export function minerFee(f: TxFlow): number {
  return f.walletIn + f.otherIn - f.walletOut - f.otherOut;
}

export interface EscrowRow {
  branch: string;
  transactions: number;
  /** Satoshis the escrow's transactions moved into its contract coins. */
  deposited: number;
  /** Satoshis its transactions moved out of the contract coins (to the wallet). */
  paidOut: number;
  minerFees: number;
  /** deposited - paidOut: what its transactions left in contract coins. */
  locked: number;
}

/** One row per escrow branch, in the order the branches first appear. */
export function escrowRows(flows: readonly TxFlow[]): EscrowRow[] {
  const rows = new Map<string, EscrowRow>();
  for (const f of flows) {
    if (f.branch === undefined) continue;
    const row = rows.get(f.branch) ?? { branch: f.branch, transactions: 0, deposited: 0, paidOut: 0, minerFees: 0, locked: 0 };
    const net = f.otherOut - f.otherIn;
    row.transactions += 1;
    if (net > 0) row.deposited += net;
    else row.paidOut -= net;
    row.minerFees += minerFee(f);
    row.locked = row.deposited - row.paidOut;
    rows.set(f.branch, row);
  }
  return [...rows.values()];
}

export interface Reconciliation {
  /** Satoshis the wallet received from transactions it put no coin into (its funding). */
  fundingIn: number;
  /** Satoshis the wallet's own transactions paid to locks that are neither the wallet nor an escrow (a swap). */
  paidElsewhere: number;
  /** Miner fees of every transaction the wallet put a coin into. */
  minerFees: number;
  /** Left in contract coins, from the flows. */
  locked: number;
  /** What the wallet holds now, read from its coins. */
  walletNow: number;
  /** fundingIn - paidElsewhere - minerFees - locked - walletNow; zero when every satoshi is accounted for. */
  unexplained: number;
}

export function reconcile(flows: readonly TxFlow[], walletNow: number): Reconciliation {
  const ours = flows.filter((f) => f.walletIn > 0);
  const fundingIn = sum(flows.filter((f) => f.walletIn === 0).map((f) => f.walletOut));
  const paidElsewhere = sum(ours.filter((f) => f.branch === undefined).map((f) => f.otherOut - f.otherIn));
  const minerFees = sum(ours.map(minerFee));
  const locked = sum(escrowRows(flows).map((r) => r.locked));
  return { fundingIn, paidElsewhere, minerFees, locked, walletNow,
    unexplained: fundingIn - paidElsewhere - minerFees - locked - walletNow };
}
