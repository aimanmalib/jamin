# 0001: Port OpenPeerEscrow to SolidCash

Date: 2026-11-17. Status: accepted.

## Context

The bounty asks for a Solidity-syntax contract that compiles to Bitcoin Cash with SolidCash, is tested with SolidHat and runs
on mainnet. Porting an existing EVM project is encouraged. Peer-to-peer fiat trades need an escrow so that neither side has to
trust the other with the coins, and there is no such escrow for BCH and CashTokens today.

`OpenPeerEscrow.sol` (openpeer/openpeer_contracts, commit 34f8d24e92f42b3da67fb89d83c42970d99eb452, MIT) implements exactly this
flow on EVM chains: create, mark as paid, release, buyer cancel, seller cancel after a waiting time, dispute with a fee from
both sides, arbitrator resolution, fee in basis points.

## Decision

- Port the trade flow of `OpenPeerEscrow.sol`, keeping its function and event names where they still make sense.
- Authorise every role (seller, buyer, arbitrator) with a signature check against a public key stored in the escrow state,
  not with `msg.sender`. The SolidCash documentation states that `msg.sender` is not verified under the `direct` composition.
- Lock outputs with covenant checks (output count, recipient script, amount, token category) and test each check by
  tampering with it.
- Drop EVM-only parts: ERC2771 meta transactions, the fee discount NFT, the proxy deployer and `Initializable`. The reason for
  each is recorded in `docs/PORTING.md`.
- The file form (`.scash` or `.sol` with `evmCompat`) and any split into several contracts is decided by measured script size
  in a later decision record, not by taste.
- Test on three networks in order: the SolidCash mock network (SolidHat), BCHN regtest in Docker with real consensus limits,
  then mainnet from the project's own test wallet under a fixed spending budget.
- SolidHat's own `mainnet` network entry is not configured. Mainnet transactions go only through the project scripts, which
  enforce the spending budget before broadcasting.

## Consequences

- The UTXO model has no shared contract storage, so each escrow is its own contract output whose state moves with each
  transaction. Functions that read or write a global mapping in the original are mapped to per-escrow state.
- If a feature does not fit the BCH unlocking script limit, it is cut in this order: basis point fee to a fixed fee, dispute
  fee from both sides to one side, BCH and token escrow in one contract to two instances. Each cut gets its own decision record.
