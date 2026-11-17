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

## Regtest (real consensus limits)

Measured 2026-11-17 17:19 UTC on a stock Bitcoin Cash Node 29.0.0 (`/Bitcoin Cash Node:29.0.0(EB32.0)/`, image
`mainnet/bitcoin-cash-node:v29.0.0`), not a relaxed build. Commands:

```
bash scripts/regtest-node.sh start
npx tsx scripts/lifecycle.ts --network regtest
bash scripts/regtest-node.sh stop
```

The node runs with `-acceptnonstdtxn=0`, so relay standardness rules apply as on mainnet (BCHN regtest accepts
non-standard transactions by default), and with `-upgrade12activationtime=1690000000` so the May 2026 upgrade is
active from the first block, as it is on mainnet now. The chain is in tmpfs and is discarded on stop
(decision 0004). Parties are keys of a phrase made for the run and never stored. Terms from `config/jamin.json`:
BCH escrow 20,000 sats (fee 30 basis points, raised to the 546 sat floor), dispute fee 5,000 sats, waiting time
3,600 seconds; token branch 200 units of a token minted on this chain (fee 1 unit, 1 reserve unit).

All five branches passed, and each branch checked on the node what the recipients received and that the escrow
kept only its reserve. Every transaction below was accepted to the mempool and mined at the height shown.

| Branch | Step | Txid | Height | Tx bytes | Inputs | Largest unlocking script |
|---|---|---|---|---|---|---|
| A | createEscrow | `c8188d2888fd43110d856c90df6035aa1f303aff7dbac1c7c2c42c4718a36409` | 213 | 758 | 1 | 100 / 10,000 |
| A | fund | `0e98117aede2b6f65b6fe2301ae2ac1ddfd16a9ef52f4627d050d8105cfbd1dd` | 214 | 6743 | 5 | 5289 / 10,000 |
| A | markAsPaid | `aab628a4c2dd6719620f469759425c78e6007d7f94abed8048da3a8c5e08a065` | 215 | 6039 | 3 | 5289 / 10,000 |
| A | release | `1fcdde184be53988950db71353c0b270f5a725aaafe7311913a4d4112b80812e` | 217 | 7096 | 7 | 5289 / 10,000 |
| B | createEscrow | `659daf8f932a9920282fbe5565d7aa200ce337b71dabe6d2c5b7211e314e1f4b` | 223 | 754 | 1 | 100 / 10,000 |
| B | deposit | `f3b7bf4f08fc0999a3399f64214beb4ec64f1cf6ebb5d945e7f40fc9c9bd0088` | 224 | 8291 | 6 | 6759 / 10,000 |
| B | markAsPaid | `a1cb52810556e0c1bf910f94f9306546679be4dbb167093037b0f4015267f22f` | 225 | 7509 | 3 | 6759 / 10,000 |
| B | release | `852e7149b148ddfb4486b316c4635e1325ac489353e2c02500e43b7c27f3c92c` | 227 | 8619 | 7 | 6759 / 10,000 |
| C | createEscrow | `116aa7bdd954d69d62c86c38167735b227d2d19bbe29ef62513263a5965d6973` | 230 | 758 | 1 | 100 / 10,000 |
| C | fund | `8931b46e200124ca933383ee282cb69224d163d28dc7f8b1c23e3b122a95acf7` | 231 | 6743 | 5 | 5289 / 10,000 |
| C | markAsPaid | `d299db7d4d2cfb1dc35e53520e75cf1a47dc0b4d9ffaff1d3e6d80e6dafa6578` | 232 | 6039 | 3 | 5289 / 10,000 |
| C | buyerCancel | `83c878c11ec18b02f1c2b2264b698db0058e32d7a70c783d32cc9ebe9f470bfb` | 233 | 6918 | 6 | 5289 / 10,000 |
| D | createEscrow | `f16fbabef403ee722458df341ff02810d76a6fa3245a734c180cb41560852e68` | 236 | 758 | 1 | 100 / 10,000 |
| D | fund | `28f7e346e8047deb676d3912cb61d843a10bac3da75b2b7292e449730ed38a12` | 239 | 6796 | 6 | 5289 / 10,000 |
| D | sellerCancel | `7beb343dc44ec3b9f5f97dd7bd40e5111471da1ad4ebbcd6eecec8dfdea38eff` | 250 | 6918 | 6 | 5289 / 10,000 |
| E | createEscrow | `54e0ad33acf8f97890467ceddc8e16d5cc6a9cf334be2f9140e2e0a790a9f026` | 253 | 758 | 1 | 100 / 10,000 |
| E | fund | `da45a24d5fac97142b1f483996ae517d93703b7ba0dded67f4679be66d90d42a` | 254 | 6743 | 5 | 5289 / 10,000 |
| E | markAsPaid | `9428b0b92cf60b248592479c86dc61a02b432f0fd71c9d46ddcee5bd4d437bdb` | 255 | 6039 | 3 | 5289 / 10,000 |
| E | openDispute | `7731186eb633ef77030d1981905f03de7229acc32dcae3e765a900e490e68990` | 256 | 7107 | 6 | 5290 / 10,000 |
| E | resolveDispute | `97208305e4eeb5929f9e145f8636eb0d15a61dbb564ce270a3404a9e1db89a0c` | 258 | 7457 | 8 | 5290 / 10,000 |

Notes from the same run:

- 20 transactions, no rejection by the node. The largest unlocking script of each step is the same as on the mock
  network above (5,289 / 5,290 / 6,759 bytes). Transaction sizes differ by up to 2 bytes (signature length), and
  by the number of coins the caller's wallet adds: `fund` with 5 inputs is 6,743 bytes, with 6 inputs 6,796.
- The largest unlocking script is 6,759 bytes (token escrow), 68% of the 10,000 byte input limit; the largest
  transaction is 8,619 bytes. No feature was cut for size.
- Branch D waited for the seller's waiting time by advancing the node's mock clock and mining blocks until the
  median time past passed it (heights 239 to 250), then spent with a time-type locktime one second behind it.
- The SDK prints `STB debug() best-effort error: ... NotSeller` and similar lines on calls that then succeed. They
  come from a `console.debug` in its send discovery probe and do not affect the broadcast transaction.
- A full run takes 2 to 3 minutes on this host with the node limited to one CPU.

## Test count

`npx solidhat test` on 2026-11-17: 8 files, 71 tests (BCH 11 lifecycle, 11 rejections, 13 state rules, 8 payout
checks; CashToken 6 lifecycle, 11 rejections, 6 payout checks; 5 end-to-end branches).

## Web app end-to-end tests

`npm run build && npx playwright test` on 2026-11-17 18:05 UTC, Playwright 1.65.1, against `vite preview`: 22 tests
passed (11 specs, each on Chromium desktop and WebKit with the iPhone 13 profile). The specs cover the five lifecycle
branches played in the browser simulator on the compiled artifacts (A BCH release with a NotBuyer rejection first,
B token release, C buyer cancel, D seller cancel rejected with TooEarly and accepted after the waiting time, E
dispute with a NotArbitrator rejection then the arbitrator's decision), the first screen (one primary button in view,
banner, no console errors), the language toggle, axe WCAG 2 A/AA with no serious or critical violation on any tab,
the recorded regtest txids, a feature reference opening its source line, and no horizontal overflow at 320 px wide.

The same engine runs in Node in `tests/sim-engine.test.ts` (five branches and named rejections).


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
