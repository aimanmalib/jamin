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
- Mock network results are not a real-node result; the BCHN numbers are in the regtest section below.

## Escrow contract sizes

Measured 2026-11-18 with SolidCash 0.51.1, Node 22, mock network with the production profile, on the contracts with
the 2-of-3 arbitration panel (docs/decisions/0008). Command: `npx solidhat compile && npx tsx scripts/measure-escrow.ts`.
Sources: `contracts/`. Escrow amount 200,000 sats, fee 30 basis points (600 sats), dispute fee 5,000 sats; token
escrow 200 base units, fee raised to the one-unit floor. `resolveDispute` carries two ECDSA panel signatures.

| Artifact | Redeem script bytes | ABI entries |
|---|---|---|
| JaminEscrow | 5,114 | 8 |
| JaminTokenEscrow | 6,518 | 8 |

| Contract | Step | Tx bytes | Inputs | Largest unlocking script |
|---|---|---|---|---|
| JaminEscrow | deploy (reserve 1,000 sats) | 760 | 1 | 100 / 10,000 |
| JaminEscrow | fund | 6,874 | 5 | 5,418 / 10,000 |
| JaminEscrow | markAsPaid | 6,168 | 3 | 5,418 / 10,000 |
| JaminEscrow | release | 7,227 | 7 | 5,418 / 10,000 |
| JaminEscrow | buyerCancel | 7,049 | 6 | 5,418 / 10,000 |
| JaminEscrow | sellerCancel | 7,049 | 6 | 5,418 / 10,000 |
| JaminEscrow | openDispute | 7,237 | 6 | 5,419 / 10,000 |
| JaminEscrow | resolveDispute | 7,667 | 8 | 5,499 / 10,000 |
| JaminTokenEscrow | deploy | 754 | 1 | 100 / 10,000 |
| JaminTokenEscrow | deposit | 8,420 | 6 | 6,888 / 10,000 |
| JaminTokenEscrow | markAsPaid | 7,638 | 3 | 6,888 / 10,000 |
| JaminTokenEscrow | openDispute | 8,671 | 6 | 6,856 / 10,000 |
| JaminTokenEscrow | resolveDispute | 9,840 | 11 | 6,967 / 10,000 |

Before the panel (single arbitrator, measured 2026-11-17 the same way): redeem scripts 5,053 and 6,457 bytes,
largest unlocking script of `resolveDispute` 5,290 (BCH) and 6,760 (token) bytes. The panel adds 61 bytes to each
redeem script (two more keys and the multisig check) and 209 (BCH) and 207 (token) bytes to the largest unlocking
script of a resolution; every other call grows by 129 bytes, as each call carries the whole redeem script.

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
- Mock network results are not a real-node result; the BCHN numbers are in the regtest section below.

## Sabotage checks of the rejection tests

Measured 2026-11-17 with SolidCash 0.51.1, Node 22, mock network with the production profile. Method: in a copy of
the repository, remove one contract check, recompile and run `npx solidhat test test/JaminEscrow.reject.test.ts
test/JaminTokenEscrow.reject.test.ts` (22 tests). The unchanged contracts pass all 22. Not committed: the copies were
deleted after each run.

| Check removed | Where | Tests that failed |
|---|---|---|
| `require(tx.time >= sellerCanCancelAfter, TooEarly())` | both `sellerCancel` | 2: BCH and token "... before the waiting time (TooEarly)" |
| `require(status == Funded, AlreadyMarkedPaid())` | both `sellerCancel` | 2: BCH and token "... after mark as paid ... (AlreadyMarkedPaid)" |
| `onlyArbitrator(s)` | both `resolveDispute` | 6: BCH and token "... signed by the buyer / seller / outsider (NotArbitrator)" |
| `require(status == Paid or Disputed, NotPaid())` | `EscrowBase.recordDispute` | 2: BCH and token "... before the buyer marked it paid (NotPaid)" |
| `require(msg.value == disputeFee, WrongDisputeFee())` | `EscrowBase.recordDispute` | 2: BCH and token "... wrong dispute fee (WrongDisputeFee)" |
| both `require(!...PaidDispute, AlreadyPaidDispute())` | `EscrowBase.recordDispute` | 2: BCH and token "... same side (AlreadyPaidDispute)" |
| `require(status == Funded or Paid, NotOpen())` | `EscrowBase.whenOpen` | 4: BCH and token "release / buyer cancel once disputed (NotOpen)" |

In each run every other test passed. In the `onlyArbitrator` run the failure was "promise resolved ... instead of
rejecting": the outsider's call went through.

## Sabotage checks of the payout and state tests

Measured 2026-11-17 with the same method as above. Payout runs used `test/JaminEscrow.covenant.test.ts` or
`test/JaminTokenEscrow.covenant.test.ts` with `test/lifecycle.test.ts` and the lifecycle file of that contract;
state runs used `test/JaminEscrow.state.test.ts` (13 tests). The payout checks are compiled from `this.transfer`, so
"sabotage" here means paying a different party or dropping a payment.

| Change | Where | Tests that failed |
|---|---|---|
| release pays the amount to the seller instead of the buyer | `JaminEscrow.release` | 3 of 24: lifecycle "A: BCH release ...", covenant "accepts a release whose payments are named by hand ...", BCH "marks as paid, then releases ..." |
| release drops the fee payment | `JaminEscrow.release` | 2 of 13: lifecycle "A: BCH release ...", covenant "accepts a release whose payments are named by hand ..." |
| token release pays the seller instead of the buyer | `JaminTokenEscrow.release` | 3 of 17: lifecycle "B: token release ...", token covenant "accepts a token release ...", token "releases tokens to the buyer ..." |
| `require(status == Disputed, NoDispute())` removed | `JaminEscrow.resolveDispute` | 1 of 13: "refuses a dispute resolution when no dispute is open (NoDispute)" |
| `require(status != Created, NotFunded())` removed | `EscrowBase.recordPaid` | 1 of 13: "refuses mark as paid before the deposit (NotFunded)" |
| `require(amount > 0, InvalidAmount())` removed | `EscrowBase.setUp` | 1 of 13: "refuses to create an escrow with a zero amount (InvalidAmount)" |

When the three state runs were started in parallel on the shared host, each also failed two or three slow tests by
timeout (126 s to 364 s against the 120 s limit). Run one after another, each failed only the test listed.

## Sabotage checks of the arbitration panel tests

Measured 2026-11-18 with SolidCash 0.51.1, Node 22, mock network with the production profile. Method as above: in
a copy of the repository, change one panel check, recompile and run `test/JaminEscrow.panel.test.ts` (18 tests;
the unchanged contracts pass all 18, and all 89 tests of `npx solidhat test`). Not committed; the copies were deleted.

| Change | Where | Tests that failed |
|---|---|---|
| `onlyPanel(first, second)` removed | both `resolveDispute` | 7 of 7 refusal tests run: one panel signature with an outsider (BCH and token), the same signature twice, a trading party as second signer, out of key order, Schnorr signatures, a non-member of a single-arbitrator escrow |
| threshold lowered to one: `checkMultiSig([first], [arbiterA, arbiterB, arbiterC])` | `EscrowBase.onlyPanel` | 5 of 18: one panel signature with an outsider (BCH and token), the same signature twice, a trading party as second signer, out of key order |
| the three `PartyOnPanel` checks removed | `EscrowBase.setUp` | 6 of 6 run: seller or buyer in panel slot A, B or C |

In the threshold run the Schnorr test and the single-arbitrator refusal still failed for their own reason (a Schnorr
signature or a key outside the panel in the first slot), and the three valid pairs passed, as they should.

## Regtest (real consensus limits)

Measured 2026-11-18 10:39 UTC on the contracts with the 2-of-3 arbitration panel (decision 0008), on a stock Bitcoin
Cash Node 29.0.0 (`/Bitcoin Cash Node:29.0.0(EB32.0)/`, image `mainnet/bitcoin-cash-node:v29.0.0`), not a relaxed
build. Commands:

```
bash scripts/regtest-node.sh start
npx tsx scripts/lifecycle.ts --network regtest
bash scripts/regtest-node.sh stop
npx tsx scripts/regtest-example.ts state/regtest/run-<time>.json   # writes examples/regtest.json
```

The node runs with `-acceptnonstdtxn=0`, so relay standardness rules apply as on mainnet (BCHN regtest accepts
non-standard transactions by default), and with `-upgrade12activationtime=1690000000` so the May 2026 upgrade is
active from the first block, as it is on mainnet now. The chain is in tmpfs and is discarded on stop
(decision 0004). Parties, including the three panel members, are keys of a phrase made for the run and never
stored. Terms from `config/jamin.json`: BCH escrow 20,000 sats (fee 30 basis points, raised to the 546 sat floor),
dispute fee 5,000 sats, waiting time 3,600 seconds; token branch 200 units of a token minted on this chain (fee 1
unit, 1 reserve unit).

All five branches passed, and each branch checked on the node what the recipients received and that the escrow
kept only its reserve. Branch E was decided by two of the three panel members (A and B, two ECDSA signatures checked
by `checkMultiSig`). Every transaction below was accepted to the mempool and mined at the height shown. The miner
fee is the value of the inputs less the value of the outputs, read back from the node by `src/lifecycle/inspect.ts`;
for all 20 transactions it equals the `fee` the node reports in `getblock <hash> 2`.

| Branch | Step | Txid | Height | Tx bytes | Inputs | Largest unlocking script | Miner fee (sat) |
|---|---|---|---|---|---|---|---|
| A | createEscrow | `5d87fe6dace39981953192be84857f45785b88a944e20fe760579911d8b73667` | 213 | 758 | 1 | 100 / 10,000 | 1,758 |
| A | fund | `d9e6704c85a81b9b1633d731cb174e022ebbe0d8ab47c92d7d9ffd777b978338` | 214 | 6872 | 5 | 5,418 / 10,000 | 7,062 |
| A | markAsPaid | `e75b21377af29155741875f3f1a35a2977d5a54570049a555a2c9b1cc13c9a48` | 215 | 6168 | 3 | 5,418 / 10,000 | 6,358 |
| A | release | `47e49386049db35f0545ff43473dd1b84f9f155b2d49f2ae90164c868cbdfd88` | 217 | 7225 | 7 | 5,418 / 10,000 | 7,415 |
| B | createEscrow | `a902a8bb8203f0263cf113bf4900a35ce17721f85501834dce05f1a479a65a79` | 223 | 754 | 1 | 100 / 10,000 | 1,754 |
| B | deposit | `c423dd8390532867d809c41d0e93659cbd98fbf760edf4fc2818e947ac61c599` | 224 | 8420 | 6 | 6,888 / 10,000 | 8,610 |
| B | markAsPaid | `92d94f112ea6f8fc51ea491ff164ffe690be7d84ad0e7bc72cf0507df643b652` | 225 | 7638 | 3 | 6,888 / 10,000 | 7,828 |
| B | release | `b91ccf8f5fcc60d581c01dab0af38b8c1ce550fc5829cf3acc6d3da6440aa605` | 227 | 8748 | 7 | 6,888 / 10,000 | 8,938 |
| C | createEscrow | `66205ef85b3b9d0a1b120888ec671e64753af63bd2f128698fc6d439d172a092` | 230 | 758 | 1 | 100 / 10,000 | 1,758 |
| C | fund | `746d462ea3f9664201eacfb3b9c4591fe12790dccc28f6eedd439ca673223420` | 231 | 6872 | 5 | 5,418 / 10,000 | 7,062 |
| C | markAsPaid | `7001e20c0d45a644229029052b5ed9bf9ec897c7ead58a3ad989db919db8deb2` | 232 | 6168 | 3 | 5,418 / 10,000 | 6,358 |
| C | buyerCancel | `9373e266f303803c8d7743a0c846605850fc23d29a23a61aa42dbf3c8154b1a1` | 233 | 7047 | 6 | 5,418 / 10,000 | 7,237 |
| D | createEscrow | `0f8d87cb3853199790f3d9e3e4e086bbff48c667f7cbd198affb112b5f05f47b` | 236 | 758 | 1 | 100 / 10,000 | 1,758 |
| D | fund | `02b24911e1a1afe46302c9154167c4767b2ad43763af515bf8fc430c371736ad` | 237 | 6872 | 5 | 5,418 / 10,000 | 7,062 |
| D | sellerCancel | `1f6e429c3ea3448678d1e637f279de2509d02c04be9cf2b86ebfb0d12e305f4b` | 248 | 7047 | 6 | 5,418 / 10,000 | 7,237 |
| E | createEscrow | `75402776a15b221865cab1ddd5be00378477816696341970ac75bed5eb13ed37` | 251 | 758 | 1 | 100 / 10,000 | 1,758 |
| E | fund | `85ccb5c346bb9d6b8d44b303bb87f3d5fbda3b4cc56aab3edb38e2f9eb0fd8da` | 254 | 6925 | 6 | 5,418 / 10,000 | 7,062 |
| E | markAsPaid | `7ae33a3cf33dac4a2a1b30d9d5d985860d5fe38f2bcf406917ea8ce2d8ae5b08` | 255 | 6168 | 3 | 5,418 / 10,000 | 6,358 |
| E | openDispute | `b5ce9843ac77652a7f99f7aa9bf650eef60bc33417ba05e7e2b7bd848ea52bbd` | 256 | 7236 | 6 | 5,419 / 10,000 | 7,426 |
| E | resolveDispute | `6101c36f6f5a78f84d231cf39f99f868943b7b214d953add12e6fc151e071224` | 258 | 7666 | 8 | 5,499 / 10,000 | 7,855 |

Notes from the same run:

- 20 transactions, no rejection by the node. The largest unlocking script is 6,888 bytes (token escrow),
  68% of the 10,000 byte input limit; the largest transaction is 8,748 bytes. No feature was cut for size.
- Against the single-arbitrator run, every unlocking script grows by 129 bytes (BCH 5,289 to 5,418, token 6,759 to
  6,888) and `resolveDispute` with two signatures by 209 (5,290 to 5,499), matching the mock network measurements
  above.
- Miner fees: 118,654 sats for the 20 transactions. Every contract call paid its size plus 137 to 190 sats (1.02 to
  1.03 sat per byte), from 6,358 sats (`markAsPaid`) to 8,938 sats (token `release`). Each `createEscrow` paid its
  size plus 1,000 sats (1,754 to 1,758 sats): the SDK's deployment adds a fixed 1,000 sat margin to the
  transaction size when the caller passes no `fee` (`@solidcash/solidcash` 0.51.1, `dist/stateful/sc-deploy.js`).
  The funding transactions that give each party its coins are not counted.
- Transaction sizes differ by a few bytes between runs (signature length) and by the number of coins the caller's
  wallet adds.
- Branch D waited for the seller's waiting time by advancing the node's mock clock and mining blocks until the
  median time past passed it, then spent with a time-type locktime one second behind it.
- The SDK prints `STB debug() best-effort error: ... NotSeller` and similar lines on calls that then succeed. They
  come from a `console.debug` in its send discovery probe and do not affect the broadcast transaction.
- The run took about 3 minutes on this host with the node limited to one CPU.
- Earlier runs passed the same five branches in 20 transactions: 2026-11-17 17:19 UTC (single arbitrator, before
  decision 0008) and 2026-11-18 05:03 UTC (same contracts as this run, before fees were recorded). Their
  transactions are no longer listed. Against the 05:03 run, 18 of the 20 transactions have the same size; branch E
  `fund` is 53 bytes larger here (6,925 against 6,872; 6 inputs against 5, the seller's wallet added a coin) and
  branch E `resolveDispute` one byte larger (signature length).

### Refused by the node (branch R)

Measured 2026-11-18 16:41 UTC on the same node (Bitcoin Cash Node 29.0.0, stock build, `-acceptnonstdtxn=0`).
Command: `npx tsx scripts/lifecycle.ts --network regtest --branches R`, then
`npx tsx scripts/regtest-example.ts --refused state/regtest/run-<time>.json` (writes the `refused` escrow of
`examples/regtest.json`). Each forbidden call was built by the SDK as a valid call, then changed and signed again
(decision 0015) and sent as raw bytes. The node's text is verbatim, after the provider's own retry note.

| Step | Signed by | Contract rule | Node's rejection text | Raw transaction hash |
|---|---|---|---|---|
| `sellerCancel`, locktime one second behind the median time past | seller | `TooEarly` | `non-mandatory-script-verify-flag (Locktime requirement not satisfied) (code 64)` | `1fee5cb20713c81aece3c99cb54b393c7932a6261475fc93656e2b0804d87ab1` |
| `release` | buyer | `NotSeller` | `mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation) (code 16)` | `0609cccd4e29cfb915fd5c4aca06d7df549b9cb79cb70231f230301411a46639` |

After each refusal every coin the refused transaction spent was still unspent. The escrow's mined steps:
`createEscrow` `e6cb24d2b034555ff80ce95ff8b08b40c234cd7fc5875b7162cfab3a3d64aa8a` (block 346), `fund`
`f42851632f8075ecb25e3a99ae287c47e3594bd0ec4e265280abc0be0a5622fa` (347), `markAsPaid`
`378219370c8098304770998635a868586896870af07ec08a9e687100dabf0060` (348), and the seller's valid `release`
`6b49d4f86746d0db82b4d4e08c15cd8f1a649706f1e09aaf93ad2b9573d7c0d4` (350, 7,225 bytes, fee 7,415 sats); the buyer
received the amount and the fee recipient the fee.

Failed attempts before this run, same day: the SDK's `build()` output had no change output, and the node refused it
for `absurdly-high-fee, 50060478 > 10000000 (code 256)` before checking any script; a later attempt replaced only the
P2PKH signatures because the contract signature covers its function body, not the redeem script, so the node refused
it for the signature instead of the locktime. Both led to decision 0015's capture and covered-bytecode search.

## Wallet signing (branch W)

Measured 2026-11-18 07:21 UTC on the same stock Bitcoin Cash Node 29.0.0 regtest node and settings as above, with
`npx tsx scripts/lifecycle.ts --network regtest --branches W` (decision 0009). Branch W is branch A with the seller
trading from a wallet: the protocol test wallet (`src/wallet/protocol-wallet.ts`) holds the seller's key and signs
the seller's P2PKH inputs over `bch_signTransaction`; the escrow names a role key derived from the wallet's
`bch_signMessage` signature, which signs the contract's seller check. All four transactions were mined; the
release paid the buyer the amount. The run file is `state/regtest/run-2026-11-18T07-21-15-354Z.json` (not tracked).

| Step | Signed by the wallet | Txid | Size (B) | Inputs | Largest unlock (B) | Height |
| --- | --- | --- | --- | --- | --- | --- |
| createEscrow | yes | `f6d9936926f076f207768592ae913cae2dfa3677feb09b24d40bf8aef57c89eb` | 758 | 1 | 100 | 213 |
| fund | yes | `9ebffad65b2742cbb09653aab84bf7388d21f52a30b4d21b2c198575ed9d6461` | 6,872 | 5 | 5,418 | 214 |
| markAsPaid | no (buyer key) | `5986943f72a75f4d4b657d957cb7d85e138497f97c1ee65bac696b38b6252db3` | 6,168 | 3 | 5,418 | 215 |
| release | yes | `6dca0a414d0d8fb4e76ab2a4dbb8e69f9e70e344daaadabc09c9251d10afa89a` | 7,225 | 7 | 5,418 | 217 |

The wallet's own unlocking bytecode is 100 bytes per input (a 65-byte Schnorr signature with `SIGHASH_ALL |
SIGHASH_FORKID` and a 33-byte key, with their pushes). On the mock network one `fund` call asked the role key's
signature template 11 times while the fee converged, and the release was preceded by a coin split that the wallet
also signed (`test/JaminEscrow.wallet.test.ts`); that is why a wallet cannot sign the contract argument itself (F10).

## Test count

`npm run gate` on Depot CI on 2026-11-18 08:23 UTC (run `nvg2zqcxq3`, commit e2bd231, after `npm ci`): `solidhat test`
10 files, 92 tests, all passing; vitest 15 files, 66 tests; build passed. The three new SolidHat tests are the
wallet tests in `test/JaminEscrow.wallet.test.ts` (decision 0009). Before them, on 2026-11-18: 9 files, 89 tests
(BCH 11 lifecycle, 11 rejections, 13 state rules, 8 payout checks; CashToken 6 lifecycle, 11 rejections, 6 payout
checks; 5 end-to-end branches; 18 arbitration panel tests in `test/JaminEscrow.panel.test.ts`, 16 BCH and 2 token).
On 2026-11-17, before the panel: 8 files, 71 tests.

## Web app end-to-end tests

`npx vite build && npx playwright test e2e/simulator.spec.ts e2e/pages.spec.ts` on 2026-11-18 05:50 UTC, Playwright
1.65.1, against `vite preview`: 24 tests passed in 7.7 minutes (12 specs, each on Chromium desktop and WebKit with the
iPhone 13 profile). The specs cover the five lifecycle branches played in the browser simulator on the compiled
artifacts (A BCH release with a NotBuyer rejection first, B token release, C buyer cancel, D seller cancel rejected
with TooEarly and accepted after the waiting time, E dispute: the buyer's attempt rejected with NotArbitrator, panel
member A alone (the same key twice) rejected with NotArbitrator and the trade still in dispute, then members A and B
decide; the log shows both signatures), the panel choice and signatures in Malay with no horizontal overflow, the
first screen (one primary button in view, banner, no console errors), the language toggle, axe WCAG 2 A/AA with no
serious or critical violation on any tab, the recorded regtest txids, a feature reference opening its source line,
and no horizontal overflow at 320 px wide. On 2026-11-17 18:05 UTC, before the panel UI: 22 tests passed.

On 2026-11-18 08:05 UTC the spec "W: the seller trades from a wallet that signs its own coins" passed on both engines
(`npx playwright test e2e/simulator.spec.ts -g "W:"`, 2 tests in 1.2 minutes): the seller picks a wallet, the page
shows the role key message the wallet signed, the creation, deposit and release log the inputs the wallet signed,
axe WCAG 2 A/AA has no serious or critical violation, and at 320 px wide nothing overflows.

The same engine runs in Node in `tests/sim-engine.test.ts` (five branches, named rejections, and one panel
signature refused before two decide).


## Public deployment

`deploy/deploy.sh` on 2026-11-17 19:25 UTC, image `9c68833-202611171925` (nginx 1.30.6 on Alpine, read-only, as the
`nginx` user): public `https://jamin.sasateguh.com/healthz` returned 200 on the first try, then the Playwright suite
against the public URL passed 24 of 24 tests (the 22 web app tests plus the header check of `e2e/live.spec.ts`, each on
Chromium desktop and WebKit iPhone 13) in 3.8 minutes. The same 24 tests passed earlier against the image's nginx config
on a local port, which shows the Content-Security-Policy does not block the in-browser simulator (WebAssembly) or
any other page. Response header of `/` measured with `curl -D -`:

```
content-security-policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://bch.imaginary.cash:50004; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
cache-control: no-cache, no-transform
```

Redeploy with the arbitration panel UI, `deploy/deploy.sh` on 2026-11-18 06:01 UTC, image `b73dfcb-202611180601`:
public `/healthz` 200, then 22 of 26 Playwright tests passed against the public URL in 21 minutes. The four failures
were the Chromium simulator specs B, C, D and E, each a 60 second wait for a simulated transaction while the host's
load average was 64 (every WebKit iPhone 13 test, both panel specs included, passed later in the same run as the
load fell). The automatic rollback did not start: the script re-ran itself as `deploy/deploy.sh` after changing into
`deploy/`, a path that does not exist from there (fixed, with `tests/deploy-script.test.ts`, which fails on the old
script). The image stayed live and healthy; at 06:36 UTC, load average 18, the six Chromium simulator specs passed
against the public URL in 2.7 minutes.

## Mainnet run before funding

2026-11-17 22:58 UTC, `npm run lifecycle -- --network mainnet` against `bch.imaginary.cash`: the seller address
`bitcoincash:qqjjt27z8wc44lkdd9x8jm3e2az8a5xleu92s5nusl` held 0 sat; the run printed "not funded: needs at least
1000000 sat; nothing broadcast" and exited 3. No ledger was written.

The wallet context behind the spending gate on the mock network (production profile), `tests/mainnet-context.test.ts`:
branch A records all four contract transactions in the ledger; with a budget of 100 sat the gate refuses the first
deployment before it is sent and the seller's balance is unchanged; branch D stops at its waiting time, a second run
before the time still waits, and a run after it cancels the escrow attached from its address; a 500-unit token coin is
split for branch B. With the gate on `sendRawTransaction` only, the branch A test failed: the ledger was empty because
the SDK broadcast through `sendPreparedTransaction` (F9).

## Mainnet funding

- Funding: 0.00382954 BCH received from a shared test wallet, txid
  4bb58a351e756ca280ac5953149ee5be1edee441494ac37d12706535807cabd9, for the mainnet lifecycle run (branches A, C, D,
  E). 1,000,000 sats were requested; the shared wallet keeps a reserve and could release 382,954.
- 2026-11-18 13:24 UTC, `npx tsx scripts/wallet.ts address` against `bch.imaginary.cash`: the seller address
  `bitcoincash:qqjjt27z8wc44lkdd9x8jm3e2az8a5xleu92s5nusl` holds 382,954 sats confirmed, 0 unconfirmed. This is below
  `mainnet.minFundingSats` (1,000,000) in `config/jamin.json`, so `npm run lifecycle -- --network mainnet` still
  broadcasts nothing. No mainnet contract transaction has been sent.

## Mainnet

Measured 2026-11-18 on Bitcoin Cash mainnet through `bch.imaginary.cash`, with the contracts that have the 2-of-3
arbitration panel (decision 0008, the same build as the regtest run above). Seller, buyer, the three panel members and
the fee recipient are HD paths of the project's test wallet, so every payout went back to the wallet. Commands:

```
npm run lifecycle -- --network mainnet --branches A,C,D,E,W   # 13:29 UTC
npm run lifecycle -- --network mainnet --branches D           # 14:16 UTC, after the waiting time
```

The first run sent 19 transactions: branches A (release), C (buyer cancel), E (dispute, decided by panel members A
and B signing together) and W (the seller trades from a wallet: the protocol test wallet signs the seller's inputs
over `bch_signTransaction`, decision 0009) in full, and opened and funded the D escrow. Branch D waited for its
seller-cancel time (`escrow.sellerWaitingTimeSeconds`, 3,600 s, against the median time past) and exited 75 with
"retry after 2026-11-18 14:15 UTC". The second run attached to the D escrow from its address and cancelled it. Every
step passed the run's own checks (payout amounts and final status). Raw runs: `state/mainnet/run-*.json` (not tracked);
the record the web app reads: `examples/mainnet.json`.

Before the run, `mainnet.minFundingSats` was lowered from 1,000,000 to 300,000 sats (decision 0011); the budget of
2,000,000 sats is unchanged. The spending gate's ledger counted 238,950 sats taken out of the wallet (it counts
deposits into escrows and does not credit payouts back, so it overstates).

| Branch | Escrow address |
| --- | --- |
| A | `bitcoincash:p0rzhffazzlqrwavmdx3xz3vg8j83zwa3h8jr0y9dknxldnqv5uvsqkjn7f9p` |
| C | `bitcoincash:pv5u2cj7qfs23x0zv64g8re5a2glfz93eu53aaae9v88hr9uz9mhzp606egex` |
| D | `bitcoincash:pvflen00umg0ufq4pkcncam0rfz24m387epgfhgzch9m3dpx383hupa2yldy8` |
| E | `bitcoincash:pd0htct8fexeqr9raun4zljmauspwxs8f38cazxwjv55nchpx9gg5nf6cncfv` |
| W | `bitcoincash:pw3qm4hjgz5xgp0eke5sq7mf2rjdrye95kkqxjws7mklr2uwfqtf5g0cmgl8w` |

| Branch | Step | Txid | Size (B) | Miner fee (sat) | Block | Signed by the wallet |
| --- | --- | --- | --- | --- | --- | --- |
| A | createEscrow | `036a658da39d983d739594cdc7dee42a14b0faf21cdb8c23f499fd9534ebfde8` | 758 | 1,758 | 977889 |  |
| A | fund | `96f2b3fc8d4a73a9cfebeda07df4fc32d89b8b49b2a825a82f5e1aae8d98d206` | 6,872 | 7,062 | 977889 |  |
| A | markAsPaid | `6c1d907e6ae0a94dd55b8d1d3f7840a2092e7909815af273f4052945cd52ea92` | 6,168 | 6,358 | 977889 |  |
| A | release | `2a89adc5b28aa0ffb1bfd43de212a24d0800d2c4bfbc480328c8f03609406311` | 7,225 | 7,415 | 977889 |  |
| C | createEscrow | `786a758bdad28ecd3e1f75be31445cb658f9b0b5dd491c537ee85ca63c238362` | 758 | 1,758 | 977889 |  |
| C | fund | `1c063be47cc40144463424de8880389e629cbbd112b5ae844674bdf2c23a57c1` | 6,872 | 7,062 | 977889 |  |
| C | markAsPaid | `d2bd1c158d8ddefca2d4954ef32bf4d5cb91b41dba9dc73df8d673a66d3973fe` | 6,168 | 6,358 | 977889 |  |
| C | buyerCancel | `55aee198c4e943547f40a24e346915973d1a98dbc985fcbcbf0466550d78720f` | 7,047 | 7,237 | 977889 |  |
| D | createEscrow | `f7dd726c5456786bf48b667b636d2f7f53038fed578222ff3befa014d87bf619` | 758 | 1,758 | 977889 |  |
| D | fund | `9847ee3724f3ab166d4f04ee111b4ca5c48d1d03ebead3ff61b57b7bce0e0c60` | 6,872 | 7,062 | 977889 |  |
| D | sellerCancel | `be0141d852260df7e55106f0590260c6f2780f134bc2c5fccfea77892557db5e` | 7,047 | 7,237 | 977896 |  |
| E | createEscrow | `544af7b142238b2115792ad6bf6bae6d41d3f4b04df331bf9bb64229639e85d9` | 758 | 1,758 | 977889 |  |
| E | fund | `309372d30678f74f73e9e55708ca1595f01f5c15f3508ba52006ce8bb10de6b6` | 6,872 | 7,062 | 977889 |  |
| E | markAsPaid | `8eac9c8bcb988c72478865f33beedc098c5658ecb7d218d9d71e1d2c6b515f67` | 6,168 | 6,358 | 977889 |  |
| E | openDispute | `28cbb8cc839fcc3726dc84adfc58eec527cb3fac5d3540582cf16e1840d19636` | 7,236 | 7,426 | 977889 |  |
| E | resolveDispute | `48088fcbef115f0e074b7e642b6f664476ac091e0f88cfa9c140a8a7bdaad1d4` | 7,664 | 7,855 | 977889 |  |
| W | createEscrow | `1699538391ba4dfc51ba49c1d2e3a35d2f807bc6195fee7c888d0318b1cc3a16` | 758 | 1,758 | 977889 | yes |
| W | fund | `c205bd65fecfe28f48446be5b65c25039dcdb4762225099ca655b96109b71eae` | 6,872 | 7,055 | 977889 | yes |
| W | markAsPaid | `95814a33ee37ac5d997bcb98e498e36aec129b1ee485a270f128d64e1c61875d` | 6,168 | 6,358 | 977889 |  |
| W | release | `2d96b99c5bab24fe2d8a246b21d260b4cd27d1ce21cb73607ba952f01a386f8e` | 7,225 | 7,408 | 977889 | yes |

20 transactions; miner fees for them 114,103 sats, about 1.03 sat per byte, the same per call as on regtest. Three
txids were opened on blockchair.com (`036a658d...` createEscrow A, `48088fcb...` resolveDispute E, `2d96b99c...`
release W): each in block 977889 with the size and fee in the table.

Where the wallet's coins went, measured at 14:20 UTC through the same Electrum server: the six wallet addresses held
208,582 sats, down from 382,954. The difference of 174,372 sats is the 114,103 sats of fees above, 3,489 sats of fees
for the wallet's own payments before the branches (topping up the buyer and the arbitrator, the coin each deployment
spends), and 56,780 sats left in 50 coins at 40 contract addresses. Each deployment opens several token container coins,
most of 1,200 sats, besides the satoshi reserve, and each call adds one (for example createEscrow A:
seven contract outputs; fund and release one new 1,200 sat coin each). The run has no call that spends them, so on
mainnet each escrow cost about 11,356 sats of locked coins on top of its miner fees.

### Branch B: a PUSD escrow

Measured 2026-11-18 through `bch.imaginary.cash`, same contracts and wallet. The wallet held no PUSD, so the seller
bought the 12 units branch B deposits (0.10 PUSD traded, a fee of 0.01, and 0.01 that stays in the token container)
from Cauldron pools (decision 0012):

```
npx tsx scripts/buy-token.ts --send                          # 15:16 UTC
npm run lifecycle -- --network mainnet --branches B          # 15:17 UTC
```

- Pool list: 58 PUSD pools listed by the indexer, 58 matched their output on chain. Quote and trade: 12 units for
  58,024 sats into the pools (trade fee 173 sats, about 4,835 sats per 0.01 PUSD), miner fee 922 sats, 922 bytes.
  Txid `f7e275d77c01a5cab5c0b363704e8c6d960a5dd89c87329022ac534a8b7ea320`.
- The escrow (`bitcoincash:pvzeftjpt3aujxlz7nc7q6pkn6dwtu63pzr9a5lcr9mljvatt0n3un643e0zg`) passed the run's checks:
  the buyer received 10 units, the fee recipient 1 unit, the token container kept 1 unit.

| Branch | Step | Txid | Size (B) | Miner fee (sat) |
| --- | --- | --- | --- | --- |
| B | createEscrow | `6e2dd9b0522b54433f2136b35471101b8d6754db334f5bf380a306958b964559` | 750 | 1,750 |
| B | deposit | `d46f258decb247ac12c11e8326745b75e9a8e1244a7772f4ba4f6fb24dfe284d` | 8,416 | 8,606 |
| B | markAsPaid | `3fc946b3b9fc261b6d4c993e95f74d9babcb0558fb849908c1b07cc494332c8c` | 7,638 | 7,828 |
| B | release | `f4c15c7f19a2feea5cc58f87bf805f6e0a4b5ea93c0c8d0a992c756b741e7327` | 8,744 | 8,934 |

Miner fees for the four calls: 27,118 sats, within 4 bytes and 4 sats of each regtest call. Largest unlocking script
6,888 of 10,000 bytes, as on regtest. The spending gate's ledger stood at 339,365 of 2,000,000 sats after the run.

Wallet at 15:31 UTC: the six addresses held 108,167 sats (seller 30,507; buyer 44,877 and 10 PUSD units; arbitrator
29,945; fee recipient 2,838 and 1 PUSD unit), down 100,415 from 208,582. That is the purchase (58,024 + 922), the
four miner fees (27,118), and 14,351 sats that did not return to wallet addresses: the escrow's contract coins and
the satoshis of the token coins that went into it.


### Refused on mainnet

Measured 2026-11-18 17:47 UTC through `bch.imaginary.cash`, same contracts and wallet, with the method of the regtest
run above (decision 0015): each forbidden call was built by the SDK as a valid call, changed and signed again, and
sent as raw bytes, so the network judged it and not the SDK. The seller address held 30,507 sats, below branch R's
floor, so `npm run wallet -- gather` first moved spare coins of the other wallet addresses to the seller in one
payment (decision 0016; txid `4a508bc4df40c267ecdbd746b771bb595e7c5393804927048175fd7d7f86044d`, miner fee 1,099
sats; seller 30,507 to 64,668 sats). No new funding was used.

```
npm run wallet -- gather                                     # 17:46 UTC
npm run lifecycle -- --network mainnet --branches R          # 17:47 UTC
```

Escrow: `bitcoincash:pwkpp64jclgq6wfzr87cam9ucqsyfy7we9zxuxy5ajdst2ml5sveyyzrpal8v`. The server's text below is
verbatim; Fulcrum puts its own first line in front of the node's reason.

| Step | Signed by | Contract rule | Server's rejection text | Raw transaction hash |
|---|---|---|---|---|
| `sellerCancel`, locktime one second behind the median time past | seller | `TooEarly` | `the transaction was rejected by network rules.` / `non-mandatory-script-verify-flag (Locktime requirement not satisfied) (code 64)` | `91f3e47a89864913ba141e974e423d465aea12ecacf0aa57c4d0dd5712ca1aec` |
| `release` | buyer | `NotSeller` | `the transaction was rejected by network rules.` / `mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation) (code 16)` | `ff5c1eb27af74d6a756c4e119dc36ad6b5e761fa5ab211918c78388084e686d1` |

After each refusal the run read the escrow's coins back and every coin the refused transaction spent was still
unspent. At 17:50 UTC the server answered `No such mempool or blockchain transaction` for both raw hashes. The
reasons are the same as on the regtest node. Two invalid broadcasts in the run; the spending gate recorded each as
an attempt of 0 sats.

| Branch | Step | Txid | Size (B) | Miner fee (sat) | Block |
| --- | --- | --- | --- | --- | --- |
| R | createEscrow | `dcf5d2fa07115df148469d7213a12b98d2446e5441025e7df1668ffc49552f15` | 758 | 1,758 | 977918 |
| R | fund | `4c8bed17e9c7157899f4981f4f504545243a1a69813de80c2f767c2e4bc9ad8b` | 7,013 | 7,062 | 977918 |
| R | markAsPaid | `d6b197c644e0498cc0dc9e19c89d1c54094fd036fb6812ff4783119dc05ae3f1` | 6,168 | 6,358 | 977918 |
| R | release (seller, valid) | `b236ec3afc94fa41e116973314fd23f7b5feeadc7efc3180f13a0fc56e6f9ed3` | 7,225 | 7,415 | 977918 |

Miner fees for the four calls: 22,593 sats, the same per call as branch A. The spending gate's ledger stood at
388,704 of 2,000,000 sats after the run.

Wallet at 17:50 UTC: the six addresses held 68,359 sats (seller 15,371; buyer 32,442 and 10 PUSD units; arbitrator
20,000; fee recipient 546 and 1 PUSD unit), down 39,808 from 108,167. That is the gather fee (1,099), the four miner
fees (22,593), and 16,116 sats for the seller's genesis-coin payment fee and the coins the escrow keeps at its
contract addresses, not split further here.

## Final state

Measured 2026-11-18 19:30 UTC (tip 977927) through `bch.imaginary.cash` with `npx tsx scripts/contract-coins.ts`: every
coin at every address of the seven mainnet escrows (Electrum `listunspent`), and every transaction in the history of the
six test wallet addresses (51). Contract builds: `JaminEscrow` `019bda79`, `JaminTokenEscrow` `abe283d5` (first eight
hex of the SHA-256 of the artifact bytecode); all seven escrows run these builds. Nothing is broadcast without
`--claim` or `--early`; the entry points are tried on a mirror, a mock network holding exact copies of the contract's
coins as the chain lists them, plus made-up fee coins for each party.

What each escrow's transactions put into contract coins, took back out, paid miners, and left there. The identity
burn (below) is counted with the escrow whose coin it spent.

| Escrow | Status | Txs | Deposited | Paid out | Miner fees | Left in contract | Of which event records | Other contract coins |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A `p0rzhffazzlq` | Released | 5 | 30,702 | 20,102 | 23,271 | 10,600 | 4,800 | 5,800 |
| C `pv5u2cj7qfs2` | CancelledByBuyer | 5 | 30,702 | 20,102 | 23,093 | 10,600 | 4,800 | 5,800 |
| D `pvflen00umg0` | CancelledBySeller | 4 | 29,502 | 20,102 | 16,735 | 9,400 | 3,600 | 5,800 |
| E `pd0htct8fexe` | Resolved | 6 | 36,902 | 25,102 | 31,137 | 11,800 | 6,000 | 5,800 |
| W `pw3qm4hjgz5x` | Released | 5 | 30,702 | 20,102 | 23,257 | 10,600 | 4,800 | 5,800 |
| B `pvzeftjpt3au` (PUSD) | Released | 5 | 13,132 | 756 | 27,796 | 12,376 | 4,800 | 7,576 |
| R `pwkpp64jclgq` | Released | 5 | 30,702 | 20,102 | 23,271 | 10,600 | 4,800 | 5,800 |
| Total | | 35 | 202,344 | 126,368 | 168,560 | 75,976 | 33,600 | 42,376 |

All amounts in satoshis. "Other contract coins" per BCH escrow: the master NFT (1,200), three state NFTs (3,600) and
the satoshi container's reserve (1,000). Branch B adds its token container (1,200 sats and 1 unit, 0.01 PUSD) and a
576-sat output its deposit transaction (`d46f258d…`, output 3) paid to an address that is not one of the contract's
and that six transactions of other people also pay; no SDK path names that address, so it is counted here and not
tried.

Ways to spend each kind of coin, tried on the mirror for every escrow (same results for all seven):

| Coin kind | Coins | Sats | Path tried | Result |
| --- | ---: | ---: | --- | --- |
| Master, state NFTs, satoshi container, token container | 36 | 41,800 | `fund` / `deposit` as seller | refused: `require failed: AlreadyFunded` |
| | | | `markAsPaid` as buyer | refused: `require failed: AlreadyMarkedPaid` |
| | | | `buyerCancel` as buyer | refused: `require failed: NotOpen` |
| | | | `sellerCancel` as seller | refused: `require failed: AlreadyMarkedPaid` |
| | | | `openDispute` as buyer | refused: `require failed: NotPaid` |
| | | | `release` as seller, `resolveDispute` as panel A+B | refused by the SDK before evaluation: `Total transfer amount (2000) exceeds satoshi container balance (1000)` (B: `Total fungible token transfer amount (2) exceeds token container balance (1)`) |
| Event records (one per call, no capability NFT) | 28 | 33,600 | the event covenant's cleanup spend, sequence 144, to the wallet | accepted on the mirror; on the chain anyone may spend them 144 blocks after they were mined: from block 978033 (A, C, D, E, W), 978045 (B), 978062 (R) |
| | | | the same spend for A's four records sent at tip 977927 (`--early A`) | refused by the server: `the transaction was rejected by network rules. non-BIP68-final (code 64)` (raw hash `ab5b16a1642b3171a623dca70a5f8f3fb03fc902ea683580ceecc614a5febdfe`, ledger entry of 0 sats) |
| B's 576-sat output at an address that is not the contract's | 1 | 576 | none: no SDK path names that address | not tried |
| Identity (the category's metadata authhead, owned by the seller's lock) | 7 | 5,292 | `publishMetadata` with `action: burn` as owner | accepted on the mirror, then claimed on mainnet (below) |

Identity burns sent with `--claim`, each through the spending gate (0 sats counted, the change returns to the seller):
A `3de44ec82bad880457be207c976ae0685b6d812fe7406ceb6a8d27b6e4d88316`,
C `6125e42f79a4044647db7b9fb258c385e9f550255858014cc171670f1dc0dd61`,
D `a06400ccd6c8b4e6b1a1da9516d35ce0ec4982ddff2209848282f74deb438420`,
E `7feb688df247e1e25da03528e3d27362ac45da82b882f7714580f0889c9486e7`,
W `15da177e1918f2f644d91846617a6798405f6197da099a324eeff72062f43a8e`,
B `ee0bb971d84a5c5385b43d05ea917a864edfc55fd87bab79a952dc1c58f38094`,
R `e75e308e32db0fa0b66863c0af970b15de3ff5312083cc43b627cf309f689f3d`.
Each spends the 756-sat authhead with a seller coin; the burn's fee is 678 sats, so each returns 78 sats net.

So, of the 75,976 sats left in contract coins: 33,600 (event records) can be swept back by anyone from the blocks
above; 41,800 cannot be spent by any entry point of these builds, because every entry point checks a status the
finished escrow has left; and B's 576-sat output has no known path. A function that closes a finished escrow would not reach these seven; for
new escrows it was measured and left out (see "Closing an escrow" below).

The wallet, every satoshi:

| | Sats |
| --- | ---: |
| Funding received (txid `4bb58a35…`) | 382,954 |
| Paid to the Cauldron pools for 12 PUSD units (txid `f7e275d7…`) | 58,024 |
| Miner fees of every wallet transaction (escrows 168,560; swap, top-ups, gathering and token split 9,089) | 177,649 |
| Left in contract coins (table above) | 75,976 |
| Held by the six wallet addresses now (`listunspent`, token coins' satoshis included) | 71,305 |
| Unexplained (funding minus the four lines above) | 0 |

Total: 382,954 = 58,024 + 177,649 + 75,976 + 71,305. The spending gate's ledger (`state/belanja.json`, 53 entries)
records 388,704 sats spent: it counts what each broadcast took from the wallet and never credits payouts back, so it
overstates the true cost (382,954 - 71,305 = 311,649 sats) by 77,055.

## Closing an escrow

Measured 2026-11-18 with SolidCash 0.51.1 on the production-profile mock network. Command: `npx tsx
scripts/repro-close.ts`, which compiles a temporary copy of both escrow contracts with `close(sig s)`:
`onlySeller(s)`, `require(isFinished(), NotFinished())` (status `Released`, `CancelledByBuyer`, `CancelledBySeller`
or `Resolved`), then `selfdestruct(new LockingBytecodeP2PKH(hash160(seller)))`. Both copies compile. Each case closes
an escrow released in the previous block, with `StatefulContract.selfdestructTo` and the seller as recipient.
Decision: `docs/decisions/0013-closing-an-escrow.md`.

| Case | Result (verbatim) |
|---|---|
| BCH escrow, SDK defaults | `non-BIP68-final` (the helper adds the event records, still under their 144-block lock; F12) |
| BCH escrow, event records left out, fee from the transaction size | `Destroy transaction has no funds to reclaim after fees. Total inputs: 5800, fee: 7052.` (F11) |
| BCH escrow, event records left out, fee 1,999 sats (the covenant's ceiling) | `min relay fee not met` (F11) |
| Token escrow, event records left out, token container named, fee 1,999 sats | `Implicit burning of fungible tokens for category ... is not allowed (input amount: 1, output amount: 0). If this is intended, set allowImplicitFungibleTokenBurn to true.` (F13) |

The closing transaction spends 5,800 sats of contract coins (the master and three state coins of 1,200 sats and the
1,000-sat reserve) and is about 7,052 bytes, nearly all of it the contract's unlocking script. At the relay minimum of
1 sat per byte it needs a fee above both the statement form's ceiling (under 2,000 sats) and the coins it would
return. Earlier attempts in the same session, with `close` in the contracts and the SDK's default fee: "Transaction
fee of 7500 is higher than max fee of 2000" (released), 7388 (cancelled by the buyer, cancelled by the seller, open),
7612 (resolved).

