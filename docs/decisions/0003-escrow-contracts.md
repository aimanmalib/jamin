# 0003: Two escrow contracts on one shared base

Date: 2026-11-17. Status: accepted.

## Context

Decision 0002 chose one native stateful contract per escrow. The port must cover both BCH and CashToken escrows
(OpenPeer's native and ERC-20 escrows) with the full trade flow: mark as paid, release, buyer cancel, seller cancel
after a waiting time, dispute with a fee from either side, and arbitrator resolution.

Three SolidCash properties shape the token side:

- A token container must be indexed by a `bytes32` that is a direct function parameter, so the category cannot come
  from state alone.
- Token containers cannot be read or written in a constructor, so a deployment cannot take the tokens.
- An ordinary call cannot empty a fungible-only token container; `selfdestruct` moves BCH only.

## Decision

- `contracts/EscrowBase.scash` is an abstract contract that holds what both escrows share: the status enum, a
  `Terms` struct, events, named custom errors, role modifiers (`checkSig` against constructor keys), and the
  internal state transitions for mark as paid and open dispute. `contracts/FeeMath.scash` is a library with the
  basis-point fee rule.
- `contracts/JaminEscrow.scash` escrows BCH in the satoshi container. The seller pays the deposit in a payable
  `fund` call that requires `msg.value == amount + fee`. A constructor cannot see a deposit (F3) and `this.balance`
  reads 0 in a call without a payment (F5), so neither can carry the check.
- Both contracts use `pragma satoshicontainer single`. The SDK spends one container coin per call; without the
  pragma each dispute fee opened its own coin and the resolution could not pay out (docs/MEASURED.md). The single
  coin cannot be emptied by a call, so the deployment opens it with a reserve (`escrow.containerReserveSats` in
  `config/jamin.json`) that stays in the closed escrow.
- `contracts/JaminTokenEscrow.scash` escrows one fungible token category, fixed as a contract parameter. Each token
  entry point takes the category as a parameter and the `onlyToken` modifier requires it to equal the stored one.
  The seller deposits in a `deposit` call that pins the exact amount. Dispute fees are BCH in both contracts.
- Fee floor: the BCH fee is at least 546 sats (P2PKH dust), the token fee at least one base unit.
- Token reserve: the token deposit is amount + fee + one base unit. The unit stays in the container when the escrow
  closes. For PUSD that is 0.01 PUSD per escrow.
- An open dispute is settled only by the arbitrator: `release` and `buyerCancel` require the escrow to be funded or
  paid, not disputed.

## Consequences

- Two artifacts instead of one; each stays far below the 10,000 byte input limit (docs/MEASURED.md).
- Every escrow leaves its satoshi container reserve behind, and every token escrow also one base unit and the
  token container's satoshis. These are listed under known limits.
- A seller cancel must name its payment by hand until upstream pull request #6 is released (F6).
- The cut order in decision 0001 has not been needed: no feature was cut for size.
- Rolling back to a single BCH-only contract means deleting `JaminTokenEscrow.scash` and its tests; the base and
  the BCH contract do not depend on it.
