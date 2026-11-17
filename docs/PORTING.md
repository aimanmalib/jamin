# Porting OpenPeerEscrow to SolidCash

Source: `contracts/OpenPeerEscrow.sol` in openpeer/openpeer_contracts at commit
34f8d24e92f42b3da67fb89d83c42970d99eb452 (MIT, see NOTICE). Target: `contracts/` in this repository, native
SolidCash, one stateful contract instance per escrow (docs/decisions/0002-contract-shape.md).

## Model change

The original is one contract per seller that holds many escrows in `mapping(bytes32 => Escrow) escrows`, keyed by a
hash of order id, buyer, token and amount. On Bitcoin Cash there is no shared contract storage, so each escrow is
its own contract instance: its own CashToken category, its own state, its own satoshi and token containers. The order
hash, the `exists` flag and the `EscrowNotFound` error are therefore not needed: an escrow that does not exist has
no address to call.

Roles are constructor public keys. Every role action requires `checkSig` against the stored key. `msg.sender` is
never used, because SolidCash does not verify it under the `direct` composition.

## Functions

| OpenPeerEscrow | Jamin | Notes |
|---|---|---|
| `initialize(...)` | contract parameters + `constructor` | Seller, buyer, arbitrator and fee recipient are contract parameters; amount, fee rate, dispute fee and cancel time are constructor arguments. |
| `createNativeEscrow` | deploying `JaminEscrow`, then `fund` | A constructor cannot check a deposit (docs/SOLIDCASH-FINDINGS.md, F3) and `this.balance` reads 0 in a call without a payment (F5), so the seller pays amount + fee in a payable `fund` call that requires `msg.value` to match. |
| `createERC20Escrow` | deploying `JaminTokenEscrow`, then `deposit` | Token containers cannot be touched in a constructor, so the seller deposits in a separate call that pins the exact token amount. |
| `create` (internal) | `EscrowBase.setUp` | Same checks: positive amount. Added: positive dispute fee, cancel time must be a timestamp. Buyer and seller being different keys is not checked on chain. |
| `markAsPaid` | `markAsPaid` | Buyer only, only after the deposit. Fails instead of returning `false` when already paid (`AlreadyMarkedPaid`). |
| `release` | `release` | Seller only. Amount to the buyer, fee to the fee recipient. Not allowed once a dispute is open (see below). |
| `buyerCancel` | `buyerCancel` | Buyer only. Amount and fee back to the seller. Not allowed once a dispute is open. |
| `sellerCancel` | `sellerCancel` | Seller only, only while not marked paid and only after `sellerCanCancelAfter` (`tx.time`). Fails instead of returning `false`. |
| `openDispute` | `openDispute(sig, byBuyer)` | Payable; `msg.value` must equal the dispute fee. Each side can pay once. |
| `resolveDispute` | `resolveDispute(sig, buyerWins)` | Arbitrator only. Buyer win: amount to buyer, fee to fee recipient. Seller win: amount and fee to seller. The winner's dispute fee is returned if it paid one; the loser's paid fee goes to the fee recipient. |
| `transferEscrowAndFees` (private) | inline `this.transfer` / `this.tokens[c].transfer` | Each payout is a covenant output: recipient script and amount are fixed by the contract. |
| `withdraw` (private) | dropped | Payouts are covenant outputs; there is no separate pull step. |
| `openPeerFee`, `sellerFee` | `FeeMath.tradeFee` | Basis points of the amount, with a floor (see below). |
| `getEscrowAndHash` | dropped | No mapping and no order hash. |
| `deposit`, `withdrawBalance`, `balances` | dropped | The seller-level balance pool for "automatic escrow" has no counterpart: each escrow holds exactly its own coins. |
| `versionRecipient` | dropped | ERC2771 only. |

## Events and errors

| OpenPeerEscrow | Jamin |
|---|---|
| `EscrowCreated(orderHash)` | `EscrowCreated(amount, fee, sellerCanCancelAfter)` |
| `SellerCancelDisabled` | `SellerCancelDisabled` |
| `Released` | `Released(amount, fee)` |
| `CancelledByBuyer` | `CancelledByBuyer(amount)` |
| `CancelledBySeller` | `CancelledBySeller(amount)` |
| `DisputeOpened(orderHash, sender)` | `DisputeOpened(byBuyer)` |
| `DisputeResolved(orderHash, winner)` | `DisputeResolved(buyerWins)` |
| `EscrowNotFound` and string reasons | named custom errors in `EscrowBase` (`NotSeller`, `NotBuyer`, `NotArbitrator`, `NotOpen`, `TooEarly`, ...) |

## Modifiers

`onlySeller` and `onlyArbitrator` become signature checks. `onlyBuyer` is new (the original checked
`_msgSender() == _buyer` inline). `whenOpen` is new and holds the shared release and cancel precondition.

## Dropped, with reasons

- **ERC2771 meta transactions (`ERC2771Context`, trusted forwarder).** On Bitcoin Cash anyone can build and pay for a
  transaction; a role proves itself with a signature, so a relayer needs no special support.
- **Fee discount NFT and partner fee split.** They read an external ERC-721 contract and a partner registry. That
  needs cross-contract state reads, which are experimental in SolidCash, for a feature that is not part of the trade
  flow.
- **Proxy deployer and `Initializable`.** One contract instance per escrow replaces the per-seller clone; there is
  nothing to initialise after deployment.
- **Automatic escrow (seller balance pool).** It relies on shared storage across escrows (see above).
- **Release or cancel during a dispute.** In the original, `release` and `buyerCancel` stay callable while a dispute
  is open and refund the dispute fees. Here an open dispute is settled only by the arbitrator, which keeps every
  payout path to a fixed set of outputs.

## Changed, with reasons

- **Fee floor.** A BCH output below the dust limit (546 sats for P2PKH) is not relayed. The BCH escrow raises the
  basis-point fee to 546 sats when it is smaller; the token escrow raises it to one base unit.
- **Satoshi container reserve.** Both contracts use `pragma satoshicontainer single`, so the deposit and both
  dispute fees sit in one coin that a payout can spend in one call. Such a container cannot be emptied by a call, so
  the deployment opens it with a small reserve (1,000 sats in the tests) that stays when the escrow closes.
- **Token reserve unit.** An ordinary SolidCash call cannot empty a fungible-only token container. The token escrow
  takes one extra base unit at deposit and leaves it in the container when the escrow closes.
- **Seller waiting time.** The original adds `sellerWaitingTime` to `block.timestamp` at creation. SolidCash has no
  readable clock in a constructor (`tx.time` exists only inside `require`), so the seller passes the absolute
  `cancelAfter` timestamp and the buyer checks it before paying.
