# 0013: No close function for a finished escrow

Date: 2026-11-18. Status: accepted.

## Context

A finished escrow (released, cancelled or resolved) still holds coins at its contract addresses: the master and three
state coins of 1,200 sats each, the satoshi container with its 1,000-sat reserve, a token container with its reserve
unit in the token escrow, and one record coin per event. Decision 0017 showed that the current contract builds give
the master, state and container coins no spending path (41,800 sats across seven mainnet escrows). The event records
can be swept 144 blocks after they were mined.

SolidCash offers `selfdestruct` to consume a stateful contract's master and state coins and pay the satoshis out
(`language/selfdestruct.md`, SolidCash 0.51.1). The statement form `selfdestruct(recipient)` pins the transaction to
one output paying `recipient` and caps the miner fee: `sum(inputs) - outputs[0].value < 2000`. The modifier-only form
does not pin the recipient or the fee.

## What was built and measured

Both contracts were given `close(sig s)`: `onlySeller(s)`, `require(isFinished(), NotFinished())` (status
`Released`, `CancelledByBuyer`, `CancelledBySeller` or `Resolved`), then
`selfdestruct(new LockingBytecodeP2PKH(hash160(seller)))`. The destination comes from the `seller` constructor key,
which no function can change. Both compiled. Tests closing an escrow in each final state, and refusing an open
escrow, a close signed by the buyer and a payment to another address, were written against the mock network with the
production profile. The token escrow's reserve unit was to be burned by naming its container.

Closing failed in every final state (`docs/MEASURED.md`, "Closing an escrow"; reproduction `scripts/repro-close.ts`):

- The closing transaction is about 7,052 bytes, nearly all of it the contract's unlocking script, and spends 5,800
  sats. At the relay minimum of 1 sat per byte it needs about 7,052 sats of fee: more than the covenant's ceiling of
  1,999 and more than the coins it returns. With a fee of 1,999 the mock refuses it: "min relay fee not met" (F11).
- The SDK helper also spends event records still under their 144-block lock ("non-BIP68-final", F12) and refuses to
  burn the token reserve unit of a named container (F13). Both can be worked around; F11 cannot.

## Decision

- The contracts get no `close` function. A function whose only valid transaction cannot relay would be dead code in a
  contract that holds money, and it would grow every unlocking script.
- The modifier-only form is not used either. It drops the destination and fee pins that made the statement form
  safe to expose, and the size arithmetic is the same: a close would still cost more than it returns.
- Folding the destruction into the final payout call (so the transaction that already pays for the unlocking script
  also frees the coins) does not fit the statement form, which allows one output where a release needs two. Doing it
  with the modifier-only form would mean re-checking every payout by hand; it is not attempted before the code freeze.
- What stays in a finished escrow is recorded as a known limit (README, "Known limits") and accounted for in
  `docs/MEASURED.md` "Final state". The event records remain sweepable as decision 0017 describes.

## Consequences

- No contract change, so the mainnet escrows and their records remain valid for the current build.
- Every escrow keeps about 5,800 sats (BCH) or 5,800 sats and one token unit (token) at its contract addresses after
  it finishes. The 1,000-sat reserve is set in `config/jamin.json`; the 1,200-sat coins are fixed by the SDK.
- Revisit when SolidCash can unlock a single function without the whole contract (framed composition, F1) or sizes
  the destroy fee ceiling from the transaction: then a close would be cheaper than the coins it frees.
- Undo: add the `close` function shown in `scripts/repro-close.ts` to both contracts.
