# Measurements

Facts measured on this project, failures included. Each section names the command that produced it.

## Script sizes

Measured 2026-11-17 with SolidCash 0.51.1 (`@solidcash/solidc`, `@solidcash/solidcash`), Node 22, mock network with
the production profile (`new MockNetworkProvider({ profile: 'production' })`: BCH size limits, dust rule, standard
relay VM). Command: `npx tsx scripts/measure-shapes.ts`. Sources: `test/fixtures/shapes/`. Escrow amount 200,000
sats, fee 600 sats. Decision: `docs/decisions/0002-contract-shape.md`.

Compiled artifacts (redeem script bytes without constructor arguments):

| Shape | Mode | Composition | Artifact | ABI entries |
|---|---|---|---|---|
| A covenant (.scash) | native | direct | CovenantEscrow 125 B | 2 |
| B stateful (.scash) | native | direct | StatefulEscrow 2,626 B | 3 |
| B stateful (.scash) | evmCompat | direct | StatefulEscrow 2,985 B | 6 |
| B stateful (.scash) | native | framed | failed: `FRAMED_CODEGEN_UNAVAILABLE` on `new LockingBytecodeP2PKH()` (F1) | |
| B full entry set (.scash) | native | direct | StatefulEscrowFull 5,100 B | 7 |
| C mapping port (.sol) | evmCompat | direct | OpenPeerShape 5,571 B | 6 |
| C mapping port (.sol) | evmCompat | framed | OpenPeerShape 5,614 B | 6 |

Transactions on the production-profile mock network (limit: 10,000 bytes of unlocking bytecode per input):

| Shape | Step | Result | Tx bytes | Inputs | Largest unlocking script |
|---|---|---|---|---|---|
| A covenant | release | ok | 418 | 1 | 297 B |
| A covenant | buyerCancel | ok | 384 | 1 | 297 B |
| B stateful | deploy | ok | 584 | 1 | 100 B |
| B stateful | release | ok | 4,260 | 6 | 2,828 B |
| B stateful | buyerCancel | ok | 4,085 | 5 | 2,828 B |
| C mapping port | deploy | ok | 655 | 1 | 100 B |
| C mapping port | createNativeEscrow | failed: preflight `OP_VERIFY` at input 0 on the message bus path, not diagnosed | | | |

Other observations from the same runs:

- A 30 basis point fee on a 20,000 sat escrow is 60 sats; the transaction builder refuses that output as below the
  546 sat P2PKH dust limit. The runs above use 200,000 sats and a 600 sat fee.
- Release in shape B failed while it paid the buyer before the fee recipient; it passed with the smaller payment
  first (F2).
- A payable constructor that checks `msg.value` against the deposit could not be deployed with `initialBalance` (F3);
  the shape B fixture leaves that check out.
- Mock network results are not a real-node result. The regtest section will hold the BCHN numbers.

## Escrow contract sizes

Measured 2026-11-17 with SolidCash 0.51.1, Node 22, mock network with the production profile. Command:
`npx solidhat compile && npx tsx scripts/measure-escrow.ts`. Sources: `contracts/`. Escrow amount 200,000 sats, fee
30 basis points (600 sats), dispute fee 5,000 sats; token escrow 200 base units, fee raised to the one-unit floor.

| Artifact | Redeem script bytes | ABI entries |
|---|---|---|
| JaminEscrow | 5,053 | 8 |
| JaminTokenEscrow | 6,457 | 8 |

| Contract | Step | Tx bytes | Inputs | Largest unlocking script |
|---|---|---|---|---|
| JaminEscrow | deploy (reserve 1,000 sats) | 760 | 1 | 100 / 10,000 |
| JaminEscrow | fund | 6,745 | 5 | 5,289 / 10,000 |
| JaminEscrow | markAsPaid | 6,039 | 3 | 5,289 / 10,000 |
| JaminEscrow | release | 7,098 | 7 | 5,289 / 10,000 |
| JaminEscrow | buyerCancel | 6,920 | 6 | 5,289 / 10,000 |
| JaminEscrow | sellerCancel | 6,920 | 6 | 5,289 / 10,000 |
| JaminEscrow | openDispute | 7,108 | 6 | 5,290 / 10,000 |
| JaminEscrow | resolveDispute | 7,458 | 8 | 5,290 / 10,000 |
| JaminTokenEscrow | deploy | 754 | 1 | 100 / 10,000 |
| JaminTokenEscrow | deposit | 8,291 | 6 | 6,759 / 10,000 |
| JaminTokenEscrow | markAsPaid | 7,509 | 3 | 6,759 / 10,000 |
| JaminTokenEscrow | openDispute | 8,542 | 6 | 6,727 / 10,000 |
| JaminTokenEscrow | resolveDispute | 9,633 | 11 | 6,760 / 10,000 |

Notes from the same runs:

- No artifact and no unlocking script exceeds the 10,000 byte input limit; no feature was cut for size.
- Every call carries the whole redeem script in one input, so a call is 6 to 10 KB. At 1 sat per byte that is
  roughly 6,000 to 10,000 sats of miner fee per call, paid by the caller.
- The first version read `this.balance` in `markAsPaid` to check the deposit; it always read 0 (F5). The deposit is
  now checked by `msg.value` in `fund`.
- Without `pragma satoshicontainer single`, each dispute fee opened its own container coin and `resolveDispute`
  failed: "Total transfer amount (210600) exceeds satoshi container balance (200600)". The SDK spends one container
  coin per call. With the pragma all deposits go into one coin.
- Seller cancel needs its payment named by hand (F6).
- Mock network results are not a real-node result; the regtest section will hold the BCHN numbers.
