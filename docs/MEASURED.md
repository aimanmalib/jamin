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

Measured 2026-11-18 05:03 UTC on the contracts with the 2-of-3 arbitration panel (decision 0008), on a stock Bitcoin
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
by `checkMultiSig`). Every transaction below was accepted to the mempool and mined at the height shown.

| Branch | Step | Txid | Height | Tx bytes | Inputs | Largest unlocking script |
|---|---|---|---|---|---|---|
| A | createEscrow | `daf5e67e6f09716aaf25ea5f21ae5b6f068276890c61424ae0701f06c6b2da39` | 213 | 758 | 1 | 100 / 10,000 |
| A | fund | `0dba530cdedb324eae7b92640f5792016d40ab43afa6aa7e87a1f2d152831cbf` | 214 | 6872 | 5 | 5,418 / 10,000 |
| A | markAsPaid | `8677100bfbea318e63b5cd3c38396ac073f9b57ae03a8b7e49bcedfe5b3221c2` | 215 | 6168 | 3 | 5,418 / 10,000 |
| A | release | `2bd819d0843d542004e25965e746aef597fda58d0f10e2f0ab95f6e4e67eaab7` | 217 | 7225 | 7 | 5,418 / 10,000 |
| B | createEscrow | `93ce651fc6a6acdb7513dcccbcc10df751d449643fef6bc6ca0615974d2e58e1` | 223 | 754 | 1 | 100 / 10,000 |
| B | deposit | `7d0965c5cae2b3d201696b194448d75547674de7bfcdbb6c36bfdc34876c9800` | 224 | 8420 | 6 | 6,888 / 10,000 |
| B | markAsPaid | `bf445efc2d0c644ea238c4c0d4ca4496501374c054a46aa2f27dc57669b53d6a` | 225 | 7638 | 3 | 6,888 / 10,000 |
| B | release | `022450893de1faf173526119eb8d9332fa36cfb8c82ec45532732b6c3884f017` | 227 | 8748 | 7 | 6,888 / 10,000 |
| C | createEscrow | `e5a920039379edf761e54616b28f933c2360eeb95a07fc1651596dcc68b3b3a5` | 230 | 758 | 1 | 100 / 10,000 |
| C | fund | `7a440e8dd9356c9f41daf03b22ba2c294800933899e9643bf1d727f1a25ac2a3` | 231 | 6872 | 5 | 5,418 / 10,000 |
| C | markAsPaid | `2894f375e4a610c3fc2275f8cc3d11ceee904319b0b514ec936e918d4195dae7` | 232 | 6168 | 3 | 5,418 / 10,000 |
| C | buyerCancel | `bbdae62ac7d5e57631b51687def1d56e3f1f2d57986720b66edfa27d3532f1c8` | 233 | 7047 | 6 | 5,418 / 10,000 |
| D | createEscrow | `34939aeed1b3c40748608987098aa540f87c56ef1c68b2b4e669f9748e6f3738` | 236 | 758 | 1 | 100 / 10,000 |
| D | fund | `ced5e2311a8ea47ba3f52d51df7975f37a13ac50319d6a22e75d153a4728f3d8` | 237 | 6872 | 5 | 5,418 / 10,000 |
| D | sellerCancel | `46c51175788a82a6e4d1d64c9acad6b89664ab4f8678fd2c9b5153b11317c2e1` | 248 | 7047 | 6 | 5,418 / 10,000 |
| E | createEscrow | `3f5eea3a21f6e5743a6d38ec6daf60d82c6c86e9fc7de7545edf6d5767a787ef` | 251 | 758 | 1 | 100 / 10,000 |
| E | fund | `7502660553067532041989b0bb67f408798fd06761988a48f787e4b9df807b83` | 252 | 6872 | 5 | 5,418 / 10,000 |
| E | markAsPaid | `d4bd5e0bcaf7c1c5fbe385f392f585f5dec4da0b4c0b549ce9822196f3f7c360` | 253 | 6168 | 3 | 5,418 / 10,000 |
| E | openDispute | `317328965839d344603da7523d5165efe4310e860ee0411c14085220d4249cd4` | 254 | 7236 | 6 | 5,419 / 10,000 |
| E | resolveDispute | `586468ec6c6d09b221fbd76cc813b6f6493f3ab0053e70231b9c9c7ecc691b2f` | 256 | 7665 | 8 | 5,498 / 10,000 |

Notes from the same run:

- 20 transactions, no rejection by the node. The largest unlocking script is 6,888 bytes (token escrow),
  68% of the 10,000 byte input limit; the largest transaction is 8,748 bytes. No feature was cut for size.
- Against the single-arbitrator run, every unlocking script grows by 129 bytes (BCH 5,289 to 5,418, token 6,759 to
  6,888) and `resolveDispute` with two signatures by 208 (5,290 to 5,498), matching the mock network measurements
  above.
- Transaction sizes differ by a few bytes between runs (signature length) and by the number of coins the caller's
  wallet adds.
- Branch D waited for the seller's waiting time by advancing the node's mock clock and mining blocks until the
  median time past passed it, then spent with a time-type locktime one second behind it.
- The SDK prints `STB debug() best-effort error: ... NotSeller` and similar lines on calls that then succeed. They
  come from a `console.debug` in its send discovery probe and do not affect the broadcast transaction.
- The run took about 3 minutes on this host with the node limited to one CPU.
- The earlier run of 2026-11-17 17:19 UTC (single arbitrator, before decision 0008) passed the same five branches in
  20 transactions; its transactions are no longer listed because the contract has changed since.

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

`npx solidhat test` on 2026-11-18: 9 files, 89 tests, all passing (BCH 11 lifecycle, 11 rejections, 13 state rules,
8 payout checks; CashToken 6 lifecycle, 11 rejections, 6 payout checks; 5 end-to-end branches; 18 arbitration panel
tests in `test/JaminEscrow.panel.test.ts`, 16 BCH and 2 token). On 2026-11-17, before the panel: 8 files, 71 tests.

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
