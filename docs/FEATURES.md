# SolidCash features used

Each row names a SolidCash language or SDK feature, where the code uses it, and a test that runs that code on the
mock network with the production profile. Rows 1 to 21 are language features, run by `npm run solidhat:test`; rows 22
to 26 are SDK features, run by the SolidHat tests and, where named, by the `tests/` suite (`npm test`). A feature
without such a test is not listed. `tests/features-doc.test.ts` checks that every `file:line` below still points at
the named code and that every quoted test name exists.

Test files: `test/JaminEscrow.test.ts`, `test/JaminEscrow.reject.test.ts`, `test/JaminEscrow.state.test.ts` and
`test/JaminEscrow.covenant.test.ts` (BCH), `test/JaminTokenEscrow.test.ts`, `test/JaminTokenEscrow.reject.test.ts` and
`test/JaminTokenEscrow.covenant.test.ts` (CashToken), `test/JaminEscrow.panel.test.ts` (the arbitration panel, both
contracts), `test/lifecycle.test.ts` (the five branches end to end), `test/JaminEscrow.wallet.test.ts` (a seller signing through a
wallet), `tests/mainnet-context.test.ts` (the mainnet and regtest runner against the mock network).

| # | Feature | Where | Test that exercises it |
|---|---|---|---|
| 1 | Native stateful contract (state in the contract's own CashToken category) | `contracts/EscrowBase.scash:23` | every test; e.g. BCH "creates a funded escrow with the basis-point fee" |
| 2 | Abstract contract and inheritance with base parameters | `contracts/EscrowBase.scash:9`, `contracts/JaminEscrow.scash:9`, `contracts/JaminTokenEscrow.scash:10` | every test (both contracts run the base's state machine) |
| 3 | File imports | `contracts/EscrowBase.scash:3`, `contracts/JaminEscrow.scash:6` | every test (the artifacts are built from the imports) |
| 4 | Library with an inlined internal function | `contracts/FeeMath.scash:4`, called at `contracts/JaminEscrow.scash:16` | BCH "creates a funded escrow with the basis-point fee", "raises a fee below the dust limit to 546 sats" |
| 5 | `constant` | `contracts/FeeMath.scash:5`, `contracts/JaminEscrow.scash:13`, `contracts/JaminTokenEscrow.scash:14` | BCH "raises a fee below the dust limit to 546 sats"; token "takes the deposit and the buyer marks it paid" |
| 6 | Constructor with arguments (`initArgs`) | `contracts/JaminEscrow.scash:15` | BCH "creates a funded escrow with the basis-point fee"; BCH state "refuses to create an escrow with a zero amount (InvalidAmount)" and the two tests after it (F8) |
| 7 | `enum` state variable | `contracts/EscrowBase.scash:11` | every status assertion; e.g. BCH "marks as paid, then releases ..." |
| 8 | `struct` state variable, written whole | `contracts/EscrowBase.scash:13`, `contracts/EscrowBase.scash:85` | BCH "creates a funded escrow with the basis-point fee" (reads `terms`) |
| 9 | Modifiers with parameters, stacked on one function | `contracts/EscrowBase.scash:55` to `:75`, `contracts/JaminTokenEscrow.scash:19` | BCH "rejects a release signed by anyone but the seller (NotSeller)"; token "rejects a call naming another token category (WrongToken)" |
| 10 | `checkSig` role authorisation against constructor keys | `contracts/EscrowBase.scash:56` | BCH "rejects a release signed by anyone but the seller (NotSeller)", "rejects mark as paid by the seller (NotBuyer)"; BCH state "refuses a buyer cancel signed by the seller (NotBuyer)", "refuses a deposit signed by the buyer (NotSeller)" |
| 11 | Custom errors in `require` | `contracts/EscrowBase.scash:40` | BCH "... (NotSeller)", "... (NotBuyer)", "... (WrongDeposit)"; token "... (WrongToken)"; BCH and token "... (AlreadyMarkedPaid)", "... (NotPaid)", "... (WrongDisputeFee)", "... (AlreadyPaidDispute)", "... (NotOpen)"; BCH state "... (AlreadyFunded)", "... (NotFunded)", "... (NoDispute)"; token covenant "... (WrongDeposit)" |
| 12 | Events and `emit` | `contracts/EscrowBase.scash:31`, `contracts/JaminEscrow.scash:35` | BCH "emits Released with the amount and the fee"; lifecycle "A: BCH release ..." (one `Funded`, `SellerCancelDisabled` and `Released` each) |
| 13 | `payable` functions and `msg.value` | `contracts/JaminEscrow.scash:20`, `contracts/EscrowBase.scash:107` | BCH "rejects a deposit that is not exactly amount + fee (WrongDeposit)", "resolves a two-sided dispute for the buyer"; BCH and token "rejects a dispute with the wrong dispute fee (WrongDisputeFee)" |
| 14 | Satoshi container payouts (`this.transfer` to `LockingBytecodeP2PKH`) | `contracts/JaminEscrow.scash:33` | BCH "marks as paid, then releases the amount to the buyer and the fee to the fee recipient"; BCH covenant "rejects a release that pays the amount to someone other than the buyer" and the six tests after it; lifecycle A, C, D, E (the escrow keeps only its reserve) |
| 15 | `pragma satoshicontainer single` | `contracts/JaminEscrow.scash:4` | BCH "resolves a two-sided dispute for the seller" (three deposits in one coin) |
| 16 | Token container transfers (`this.tokens[c].transfer`) | `contracts/JaminTokenEscrow.scash:43` | token "releases tokens to the buyer and the token fee to the fee recipient"; token covenant "rejects a token release that pays the tokens to someone other than the buyer" and the three tests after it; lifecycle "B: token release ..." |
| 17 | Token container deposit checked with `this.outState.tokens[c]` | `contracts/JaminTokenEscrow.scash:32` | token "takes the deposit and the buyer marks it paid"; token covenant "rejects a token deposit short of amount + fee + reserve (WrongDeposit)" |
| 18 | Absolute time lock `tx.time` | `contracts/JaminEscrow.scash:48`, `contracts/JaminTokenEscrow.scash:56` | BCH and token "lets the seller cancel after the waiting time" and "rejects a seller cancel before the waiting time (TooEarly)" (F7) |
| 19 | Internal and internal view functions | `contracts/EscrowBase.scash:122` | BCH "resolves a two-sided dispute for the buyer" and "... for the seller" |
| 20 | Conditional payouts chosen by a parameter | `contracts/JaminEscrow.scash:80` | BCH "resolves a two-sided dispute for the buyer" and "... for the seller" |
| 21 | `checkMultiSig`: 2-of-3 arbitration panel with ECDSA signatures in key order | `contracts/EscrowBase.scash:66`, used by `resolveDispute` at `contracts/JaminEscrow.scash:61` and `contracts/JaminTokenEscrow.scash:68` | panel "resolves with the signatures of arbitrator and arbiterB" and the two pairs after it; "refuses one panel signature with an outsider signature", "refuses the same panel signature given twice", "refuses two panel signatures out of panel key order", "refuses Schnorr signatures, which OP_CHECKMULTISIG does not accept here", "runs with a single arbitrator who fills all three slots and signs once"; token panel "resolves for the seller with the signatures of panel members B and C"; BCH and token "rejects a dispute resolution signed by the buyer / seller / outsider (NotArbitrator)" |
| 22 | `StatefulContract.deploy` and `connect(signer)`: one instance per escrow, called by each party | `src/lifecycle/branches.ts:36`, `src/lifecycle/context.ts:82` | lifecycle "A: BCH release pays the buyer and the fee, and leaves only the reserve" and the four branches after it |
| 23 | `SignatureTemplate` with `SignatureAlgorithm.ECDSA` for the panel's `checkMultiSig` | `src/lifecycle/context.ts:64` | panel "refuses Schnorr signatures, which OP_CHECKMULTISIG does not accept here"; lifecycle "E: a one-sided dispute won by the buyer returns the buyer's dispute fee" |
| 24 | `Signer.external`: a wallet pays and signs its own inputs (`bch_signTransaction`) | `src/lifecycle/wallet-branch.ts:35` | wallet "creates, funds and releases an escrow with every seller input signed by the wallet"; runner "runs branch W with the seller signing through the wallet, every broadcast gated and recorded" |
| 25 | `TransactionBuilder` with `unlockP2PKH` and `addBchChangeOutputIfNeeded` | `src/lifecycle/mainnet.ts:54` | runner "runs branch A and records every broadcast in the ledger", "splits a larger token coin for the token branch and refuses without one" |
| 26 | `MockNetworkProvider` with the `production` profile (consensus and standardness limits) | `test/helpers/escrow.ts:48` | every SolidHat test; e.g. BCH "creates a funded escrow with the basis-point fee" |
