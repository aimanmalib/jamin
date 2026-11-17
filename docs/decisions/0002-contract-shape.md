# 0002: Contract shape: one native stateful contract per escrow, direct composition

Date: 2026-11-17. Status: accepted.

## Context

Decision 0001 left the file form and the split of the contract to measurement. Three shapes were compiled with
SolidCash 0.51.1 and run on the mock network with its production profile (BCH size limits, dust rule, standard relay
VM). The minimal port has create, release and buyer cancel. Sources are in `test/fixtures/shapes/`, the measuring
script is `scripts/measure-shapes.ts`, and the numbers are in `docs/MEASURED.md` under "Script sizes".

- **A. Stateless covenant (`.scash`).** One UTXO per escrow; the terms are constructor parameters; every spend pins
  its outputs by hand. Redeem script 125 bytes, largest unlocking script 297 of 10,000 bytes.
- **B. Native stateful contract (`.scash`).** One contract instance (its own CashToken category) per escrow; status,
  amount and fee are state variables; BCH sits in the contract's satoshi container; roles are constructor public keys
  checked with `checkSig`. Redeem script 2,626 bytes, largest unlocking script 2,828 of 10,000 bytes, 5 to 6 inputs
  per call. The same source with every target entry point (mark as paid, release, buyer cancel, seller cancel, open
  dispute, resolve dispute) compiles to 5,100 bytes.
- **C. Solidity-mode port of the original layout (`.sol`, `evmCompat`).** One contract holds every escrow in a
  `mapping(bytes32 => Escrow)` keyed by an order hash. Redeem script 5,571 bytes for three functions. Creating an
  escrow failed preflight on the mock network (not diagnosed further). The order hash needs `keccak256` (a co-spent
  compute side-car that a real network must provision), `block.timestamp` pulls in an oracle pool, the call path is
  the experimental message bus, and `msg.sender` cannot be the authorisation check under `direct` composition.

Under `evmCompat` the same native source B grows from 2,626 to 2,985 bytes (14 percent). `framed` composition could
not be measured for B: the compiler refuses `new LockingBytecodeP2PKH(...)` in a framed contract
(`docs/SOLIDCASH-FINDINGS.md`, F1).

## Decision

- Shape B: one native stateful `.scash` contract per escrow, `direct` composition. SolidHat compiles native sources
  (`compiler.evmCompat` is off in `solidcash.config.ts`).
- Seller, buyer and arbitrator are constructor public keys and every role action requires `checkSig`. The fee
  recipient is a constructor `bytes20` public key hash. Payments go through `this.transfer` to P2PKH locking bytecode
  built from those parameters, so a caller cannot choose a recipient.
- Creating the escrow is the deployment of the contract with the escrow amount in the satoshi container
  (`initialBalance`). A constructor cannot check that amount against `msg.value` at a top-level deployment (F3), so
  the buyer's first action must check the container balance on chain before the buyer pays fiat.
- Pay the smaller amount first when one call drains the container (F2).
- Fee outputs must be at least the dust limit (546 sats for P2PKH). A 30 basis point fee on a 20,000 sat escrow is
  60 sats and is not relayable; the fee rule in the full contract handles this explicitly.

## Consequences

- Shape A is the smallest but has no state, events, enums or modifiers, so a multi-step flow (mark as paid, dispute)
  needs a chain of contracts that commit to each other's addresses. It stays a fallback if B fails on a real node.
- The full entry set uses about half of the 10,000 byte input limit before CashToken support. If the full contract
  goes over the limit, the cut order in decision 0001 applies.
- Each escrow is its own category, so escrows never contend for one state UTXO.
- Regtest (real BCHN) is still needed to confirm B, because the mock network does not check hash-iteration limits.
