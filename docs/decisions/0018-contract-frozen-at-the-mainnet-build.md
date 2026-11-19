# 0018: The contracts stay at the build that ran on mainnet

Date: 2026-11-19. Status: accepted.

## Context

Two further contract features were considered after the mainnet runs:

- A refund anyone may trigger without a signature: a long time after the waiting time, an escrow the buyer never
  marked as paid returns to the seller, so a seller who is offline still gets the coins back.
- A payment proof checked with `checkDataSig`: the buyer signs the off-chain payment reference, `markAsPaid` stores
  its hash, and the arbitration panel can check it in a dispute.

Both change the contract bytecode. Every escrow on mainnet ran the current builds, `JaminEscrow` `019bda79` and
`JaminTokenEscrow` `abe283d5` (`docs/MEASURED.md`, "Final state"). The coin survey and the event record sweep in
`scripts/contract-coins.ts` rebuild each escrow's addresses from the compiled artifact, so they only work on escrows
of the build in the repository.

## What was measured

The refund was written as `refundExpired()` in both contracts: status `Funded`, `tx.time` at least 30 days after
`sellerCanCancelAfter`, the whole deposit to the seller's P2PKH address, no signature. SolidCash 0.51.1 accepts the
function without `--allow-unverified-paths`, because the payout is pinned by the covenant. `solidc --size` on
2026-11-19:

| Contract | Redeem script now (B) | With `refundExpired` (B) | Growth |
| --- | --- | --- | --- |
| `JaminEscrow` | 5,114 | 5,363 | 249 |
| `JaminTokenEscrow` | 6,518 | 6,947 | 429 |

Every call carries the whole contract, so each call to every escrow would pay about 250 (BCH) or 430 (token) sats
more. The largest call, the token `resolveDispute` at 9,840 bytes, would stay under the limits.

The seller's receive address held 5,557 sats on 2026-11-19 at 01:54 UTC, and the last funding request was only
partly met. Running the seven mainnet branches again on a new build would need far more than that.

## Decision

- The contracts are not changed again before the code freeze. Neither feature is added.
- A test (`tests/contract-build.test.ts`) compares the compiled artifacts with the builds named in
  `docs/MEASURED.md`, "Final state". A contract change makes it fail until the mainnet record is run again on the new
  build and the measurement updated.
- Both features are listed under "Known limits" in the README.

## Why

- The mainnet record is the project's evidence that the contract works under real consensus rules. A repository
  whose contract differs from the one on mainnet would no longer show that.
- The refund adds little the seller cannot already do: `sellerCancel` returns the same coins after the waiting time.
  It only helps a seller who cannot sign.
- The pending sweep of the 28 event records (from block 978062) needs the current artifact.

## Consequences

- Sellers who disappear leave an unpaid escrow locked until they sign a `sellerCancel`. Payment references are
  agreed and checked off chain, as in the original OpenPeer escrow.
- Undo: add `refundExpired` as described above (the token form takes the category and `onlyToken`), run the
  SolidHat tests, the regtest branches and the mainnet branches again, and update the build hashes in "Final state".
