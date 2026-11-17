# SolidCash features used

Each row names a SolidCash language or SDK feature, where the contracts use it, and a test that runs that code on
the mock network with the production profile (`npm run solidhat:test`). A feature without such a test is not listed.

Test files: `test/JaminEscrow.test.ts` and `test/JaminEscrow.reject.test.ts` (BCH), `test/JaminTokenEscrow.test.ts`
and `test/JaminTokenEscrow.reject.test.ts` (CashToken).

| # | Feature | Where | Test that exercises it |
|---|---|---|---|
| 1 | Native stateful contract (state in the contract's own CashToken category) | `contracts/EscrowBase.scash:20` | every test; e.g. BCH "creates a funded escrow with the basis-point fee" |
| 2 | Abstract contract and inheritance with base parameters | `contracts/EscrowBase.scash:7`, `contracts/JaminEscrow.scash:9`, `contracts/JaminTokenEscrow.scash:10` | every test (both contracts run the base's state machine) |
| 3 | File imports | `contracts/EscrowBase.scash:3`, `contracts/JaminEscrow.scash:6` | every test (the artifacts are built from the imports) |
| 4 | Library with an inlined internal function | `contracts/FeeMath.scash:4`, called at `contracts/JaminEscrow.scash:16` | BCH "creates a funded escrow with the basis-point fee", "raises a fee below the dust limit to 546 sats" |
| 5 | `constant` | `contracts/FeeMath.scash:5`, `contracts/JaminEscrow.scash:13`, `contracts/JaminTokenEscrow.scash:14` | BCH "raises a fee below the dust limit to 546 sats"; token "takes the deposit and the buyer marks it paid" |
| 6 | Constructor with arguments (`initArgs`) | `contracts/JaminEscrow.scash:15` | BCH "creates a funded escrow with the basis-point fee" |
| 7 | `enum` state variable | `contracts/EscrowBase.scash:8` | every status assertion; e.g. BCH "marks as paid, then releases ..." |
| 8 | `struct` state variable, written whole | `contracts/EscrowBase.scash:10`, `contracts/EscrowBase.scash:76` | BCH "creates a funded escrow with the basis-point fee" (reads `terms`) |
| 9 | Modifiers with parameters, stacked on one function | `contracts/EscrowBase.scash:51` to `:70`, `contracts/JaminTokenEscrow.scash:19` | BCH "rejects a release signed by anyone but the seller (NotSeller)"; token "rejects a call naming another token category (WrongToken)" |
| 10 | `checkSig` role authorisation against constructor keys | `contracts/EscrowBase.scash:52` | BCH "rejects a release signed by anyone but the seller (NotSeller)", "rejects mark as paid by the seller (NotBuyer)"; BCH and token "rejects a dispute resolution signed by the buyer / seller / outsider (NotArbitrator)" |
| 11 | Custom errors in `require` | `contracts/EscrowBase.scash:37` | BCH "... (NotSeller)", "... (NotBuyer)", "... (WrongDeposit)"; token "... (WrongToken)"; BCH and token "... (AlreadyMarkedPaid)", "... (NotPaid)", "... (WrongDisputeFee)", "... (AlreadyPaidDispute)", "... (NotOpen)" |
| 12 | Events and `emit` | `contracts/EscrowBase.scash:28`, `contracts/JaminEscrow.scash:35` | BCH "emits Released with the amount and the fee" |
| 13 | `payable` functions and `msg.value` | `contracts/JaminEscrow.scash:20`, `contracts/EscrowBase.scash:98` | BCH "rejects a deposit that is not exactly amount + fee (WrongDeposit)", "resolves a two-sided dispute for the buyer"; BCH and token "rejects a dispute with the wrong dispute fee (WrongDisputeFee)" |
| 14 | Satoshi container payouts (`this.transfer` to `LockingBytecodeP2PKH`) | `contracts/JaminEscrow.scash:33` | BCH "marks as paid, then releases the amount to the buyer and the fee to the fee recipient" |
| 15 | `pragma satoshicontainer single` | `contracts/JaminEscrow.scash:4` | BCH "resolves a two-sided dispute for the seller" (three deposits in one coin) |
| 16 | Token container transfers (`this.tokens[c].transfer`) | `contracts/JaminTokenEscrow.scash:43` | token "releases tokens to the buyer and the token fee to the fee recipient" |
| 17 | Token container deposit checked with `this.outState.tokens[c]` | `contracts/JaminTokenEscrow.scash:32` | token "takes the deposit and the buyer marks it paid" |
| 18 | Absolute time lock `tx.time` | `contracts/JaminEscrow.scash:48`, `contracts/JaminTokenEscrow.scash:56` | BCH and token "lets the seller cancel after the waiting time" and "rejects a seller cancel before the waiting time (TooEarly)" (F7) |
| 19 | Internal and internal view functions | `contracts/EscrowBase.scash:113` | BCH "resolves a two-sided dispute for the buyer" and "... for the seller" |
| 20 | Conditional payouts chosen by a parameter | `contracts/JaminEscrow.scash:80` | BCH "resolves a two-sided dispute for the buyer" and "... for the seller" |
