# 0007: Mainnet run behind a spending gate

Date: 2026-11-17. Status: accepted.

## Context

The bounty asks for an application that runs on mainnet. The lifecycle branches in `src/lifecycle/` already ran on a
stock BCHN regtest node (0004). On mainnet the coins are real, they come from a test wallet with a hard budget of
0.02 BCH (`mainnet.budgetSats`), and time cannot be moved, so branch D (seller cancel after the waiting time) cannot
finish in the run that opens it.

## Decision

- `npm run lifecycle -- --network mainnet` (`scripts/lifecycle-mainnet.ts`) runs the same branches with a wallet
  context (`src/lifecycle/mainnet.ts`). Seller, buyer, arbitrator and fee recipient are HD paths of the test wallet
  phrase in `.env`, so every payout returns to the wallet. The script prints addresses, txids and amounts only.
- The run refuses unless the Electrum server in `electrum.mainnet` is listed in `mainnet.broadcastHosts`, and stops
  before broadcasting anything while the seller holds less than `mainnet.minFundingSats` (exit 3).
- Every broadcast goes through `gateProvider` (`src/budget/gate.ts`). It wraps the provider, works out what the
  transaction takes out of the wallet (wallet inputs, read from the transactions they spend, minus outputs back to
  wallet addresses, never below zero), checks the ledger `state/belanja.json` against the budget and refuses before
  sending, and records the spend after the network accepted it. Payouts from an escrow back to the wallet are not
  credited, so the ledger can only overstate what left the wallet. The SDK broadcasts through
  `sendRawTransaction` or `sendPreparedTransaction` (F9); both are gated, and any other provider method that would
  publish a transaction is refused.
- Coins: each deployment takes an output-0 coin of the seller (an existing one, or one made by a payment to self);
  the buyer and the arbitrator are topped up once to `mainnet.partyFloatSats` for their own fees and the dispute
  fee. Branch B trades `mainnet.tokenAmount` units of the PUSD category in `tokens.pusd`; a larger PUSD coin is split
  first, and without one the branch is skipped and reported.
- Branch D is split: a run opens and funds the D escrow, saves its address and terms to `mainnet.pendingFile`, and
  exits 75 with the time to retry. A later run attaches to the escrow from its address (`StatefulContract.at`) and
  cancels it once the median time past has reached the waiting time.
- Each run adds its transactions to `examples/mainnet.json` (one escrow per `createEscrow`, with the block height
  once mined), which the web app's Lifecycle tab reads, and writes the raw run with sizes to `state/mainnet/`.

## Consequences

- `tests/mainnet-context.test.ts` runs the wallet context on the mock network with the production profile behind the
  gate: branch A with every broadcast in the ledger, a refusal before broadcasting when the budget is too low, D
  across two runs, the PUSD split and the skip without a token. `tests/gate.test.ts` checks the spend arithmetic on
  encoded transactions and the refusals; `tests/mainnet-record.test.ts` the record format.
- The run has not touched mainnet while the wallet is unfunded; the one live check so far is the refusal at 0 sat.
- Going back: the regtest path is unchanged; removing the mainnet option from `scripts/lifecycle.ts` restores the
  earlier behaviour.
