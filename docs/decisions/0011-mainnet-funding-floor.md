# 0011: Mainnet funding floor sized to the run

Date: 2026-11-18. Status: accepted.

## Context

0007 made the mainnet run stop before broadcasting while the seller address holds less than
`mainnet.minFundingSats`, set to 1,000,000 sats, half the 2,000,000 sat budget. The test wallet received 382,954 sats
(see `docs/MEASURED.md`, Mainnet funding), so the floor kept the run from starting although the run needs much less.

What the run takes from the seller at its peak, from the config and the regtest run in `docs/MEASURED.md`:

- buyer and arbitrator floats, 2 x `mainnet.partyFloatSats` = 80,000 (they stay in the wallet);
- the genesis coin, `mainnet.genesisCoinSats` = 50,000 (a payment to self);
- one open escrow at a time, `mainnet.escrowAmountSats` + `escrow.containerReserveSats` = 21,000, plus the D escrow,
  which stays open until its waiting time, another 21,000;
- network fees: 118,654 sats for all five regtest branches together.

That is about 290,000 sats, and the payouts of each branch return to wallet addresses before the next branch starts.

## Decision

`mainnet.minFundingSats` is 300,000. The spending budget `mainnet.budgetSats` (2,000,000) and the gate in
`src/budget/gate.ts` are unchanged; the floor only decides whether a run may start, the gate still refuses any
broadcast that would pass the budget.

## Consequences

- The run can start with the funds the wallet holds. If the seller runs short, the payment that cannot be covered
  throws in `src/lifecycle/mainnet.ts` before it is sent, the run reports that branch as failed, and the transactions
  already sent stay recorded.
- Going back: set `mainnet.minFundingSats` to 1000000 in `config/jamin.json`.
