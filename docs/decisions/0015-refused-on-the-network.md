# 0015: Calls the network refuses (branch R)

Date: 2026-11-18. Status: accepted.

## Context

The rejection tests run on the SolidCash mock network. On a real network the SDK evaluates every call locally and
throws before it broadcasts, so a call the contract forbids never reaches a node: a local error is not evidence that
the network enforces the rule. Two SDK details shape how a forbidden call can be sent anyway (`@solidcash/solidcash`
0.51.1, measured on regtest):

- A stateful call's `build()` returns a frame whose funding comes later: no change output and signatures that do not
  match the final transaction. Only `send()` holds the transaction that would be broadcast. Before it, `send()` may
  broadcast a plain wallet payment that makes a fee coin.
- A contract signature covers the bytecode of the function that checks it (a body defined with `OP_DEFINE` and run
  with `OP_INVOKE`), not the whole redeem script.

## Decision

- Branch R (`src/lifecycle/refused.ts`): open a BCH escrow, send two calls the contract forbids, then the valid one.
  1. `sellerCancel` before the waiting time: built with the locktime the contract asks for, then the locktime is set
     one second behind the median time past and every seller signature is made again.
  2. `release` signed by the buyer: built as the seller's release, then the contract signature is replaced by the
     buyer's over the same message. The seller's fee input is left as it was.
  3. `release` by the seller, which must be mined.
- The final transaction is taken at the provider during `send()` (`capture`); plain P2PKH payments pass through.
- `src/lifecycle/resign.ts` changes only 65-byte Schnorr signatures, and only after verifying each one against the
  original signer's key. The covered bytecode is found the same way: the pushed bytecode under which the existing
  signature verifies. A transaction where nothing verifies is not sent.
- Each refused transaction is sent as raw bytes. The run records the provider's rejection text with only the
  provider's own retry note (`Request failed after N attempts: Error: `) cut, the transaction hash, and checks that
  every coin it spent is still unspent. Refused attempts per run: 2 (at most 6 allowed by the plan for public servers).
- Record shape, the same in `examples/mainnet.json` and in the `refused` escrow of `examples/regtest.json`:
  `{ step, refused: true, by, expected, rawTxHash, serverError, at }`, placed after the step it followed, no `txid`.
- The spending gate records a refused broadcast as a 0 sat ledger entry marked `refused`. Such an entry never hides
  a later accepted broadcast of the same transaction from the budget. A transaction taken by `capture` is not
  recorded: it never reached the network.

## Consequences

- The evidence is the node's own text: `Locktime requirement not satisfied` for the early cancel and `Signature must
  be zero for failed CHECK(MULTI)SIG operation` for the buyer's release (docs/MEASURED.md). These name the failed
  consensus check, not the contract error; `expected` names the contract rule the call breaks.
- `capture` and `resign` depend on the SDK broadcasting through `sendRawTransaction` or `sendPreparedTransaction` and
  on Schnorr signatures. An SDK change there makes branch R fail before broadcasting, not send something else.
- Undo: remove `R` from the branch lists; the records keep their rows.
