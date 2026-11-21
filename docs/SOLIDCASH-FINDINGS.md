# SolidCash findings

Issues met while building this project. Versions: `@solidcash/solidc` and `@solidcash/solidcash` 0.51.1, upstream
`master` at `eda85a88d`. Reproductions: `npx tsx scripts/repro-findings.ts` (sources in `test/fixtures/findings/`); F11 to F13:
`npx tsx scripts/repro-close.ts`; F14: `tests/filler.test.ts`.
Upstream status was checked against open issues and pull requests on 2026-11-17 and again on 2026-11-18 (pull
requests #1 and #4 to #7, issues #2 and #3).

## F1: framed composition refuses `new LockingBytecodeP2PKH(...)` as if it created a child contract

- Repro: `test/fixtures/findings/FramedLockingBytecode.scash` (a stateful contract that pays
  `this.transfer(new LockingBytecodeP2PKH(to), 1000)`). It compiles with `composition: 'direct'`. With
  `composition: 'framed'` it fails with `FRAMED_CODEGEN_UNAVAILABLE: 'new LockingBytecodeP2PKH()' takes its address
  from the creator's nonce, which a framed master does not hold; create the child with a salt`. So a framed contract
  cannot pay a P2PKH output this way.
- Cause (reading the source): the framed create-address lowering treats every instantiation node as `new C()`,
  including the built-in locking bytecode constructors. The optional-lowering survey also counts them as contract
  instantiations, so with the first refusal removed the framed shape check refuses the same contract for the missing
  `CREATE` frame. `new LockingBytecodeP2SH20(...)` is refused the same way.
- Workaround in this project: `direct` composition with `checkSig` authorisation (decision 0002).
- Upstream: no matching open issue or pull request.

## F2: a call that drains the satoshi container fails when the larger payment comes first

- Repro: `test/fixtures/findings/TransferOrder.scash` pays two P2PKH outputs from a container of 3,000 sats.
  Paying 1,000 then 2,000 is sent (the funder tops the container up so it keeps a dust-safe coin). Paying 2,000 then
  1,000 fails before signing: `Full state derivation failed: Total transfer amount (3200) exceeds satoshi container
  balance (3000)`. The amounts and the container are the same in both cases; only the order differs.
- Workaround in this project: pay the smaller amount first.
- Upstream: open pull request #6 changes how automatic transfers are derived when a locktime is added; it does not
  describe this case.

## F3: a payable constructor does not see `initialBalance` as `msg.value`

- Repro: `test/fixtures/findings/ConstructorValue.scash` requires `msg.value == a` in a payable constructor.
  `StatefulContract.deploy` with `initialBalance: 5000n` and `initArgs: [5000n]` fails with `Failed to derive initial
  state commitments from constructor. Ensure the constructor writes all state variables. VM error ... OP_VERIFY`.
  With `initArgs: [0n]` it deploys, so `msg.value` is 0 even though the container is funded. The error text points at
  unwritten state variables, not at the value.
- It is unclear whether this is intended (the documentation describes `msg.value` for a child created with
  `new C{value: v}()`, not for a top-level deployment). At minimum the error message is misleading.
- Workaround in this project: the escrow does not take the deposit in the constructor; the seller pays it in a
  payable `fund` call that checks `msg.value` (see F5 for why `this.balance` is not used).
- Upstream: no matching open issue or pull request.

## F4: `MockNetworkProvider` is not assignable to `NetworkProvider` under `exactOptionalPropertyTypes`

- Repro: with `"exactOptionalPropertyTypes": true`, passing `new MockNetworkProvider()` as `provider` to `Contract`,
  `TransactionBuilder` or `StatefulContract.deploy` is a type error: `oraclePoolCategory` is `string | undefined` on
  the mock and an optional `string` on the `NetworkProvider` interface.
- Workaround in this project: `asProvider()` in `src/sdk/mock.ts`.
- Upstream: no matching open issue or pull request. Typing only; runtime behaviour is unaffected.

## F5: `this.balance` reads 0 in a function that pays nothing, so a balance check can pass on a funded contract

- Repro: `test/fixtures/findings/BalanceRead.scash`, case F5 in `scripts/repro-findings.ts`. The contract is
  deployed with 50,000 sats in its satoshi container. `atLeast` (`require(this.balance >= 1000)`) fails preflight;
  `isEmpty` (`require(this.balance == 0)`) is sent. The compiled block layout of both functions has no
  `satoshiContainer` slot, so the container input is not part of the call and `this.balance` sums nothing.
- Why it matters: the documentation describes `this.balance` as the satoshi container's value in the transaction's
  inputs, and a contract that reads it in a function without a payment gets 0 without a warning. A guard written as
  "only when empty" or "only below a cap" passes on a funded contract.
- `msg.value` in a payable function is not affected: `require(msg.value == 5000)` passes with `.withValue(5000n)` and
  fails with `.withValue(0n)`.
- Workaround in this project: the BCH escrow takes its deposit in a payable `fund` call that requires
  `msg.value == amount + fee`, and nothing reads `this.balance`.
- Upstream: no matching open issue or pull request (issues #2, #3 and pull requests #1, #4 to #7 checked on
  2026-11-17).

## F6: a call that checks `tx.time` and pays from a container is not derived once a locktime is set

- Repro: `JaminEscrow.sellerCancel` (`require(tx.time >= ...)`, then `this.transfer(...)`). Without
  `.setLocktime()` the SDK stops at `OP_CHECKLOCKTIMEVERIFY` with "incompatible locktime type". With
  `.setLocktime(t)` it fails with `VM failed at ip 9 ... OP_VERIFY; input 0`. A minimal contract with only the
  `tx.time` check (no payment) is sent with `.setLocktime(t)`; adding one `this.transfer` brings the failure back.
- Upstream: this is the case open pull request #6 describes and fixes ("derive auto transfers again when the
  re-derive adds the locktime"). Not reported again.
- Workaround in this project: the caller names the payment by hand, `.transfer(lock, amount)` for BCH and
  `.tokenContainerTransfer(category, lock, amount)` for tokens (`test/JaminEscrow.test.ts`,
  `test/JaminTokenEscrow.test.ts`, seller cancel cases).

## F7: the custom error of a `require(tx.time >= ...)` is not reported

- Repro: `JaminEscrow.sellerCancel` before `sellerCanCancelAfter`, sent with `.setLocktime(t)` for a `t` before the
  waiting time ends. The call is rejected, but the message is the VM's "Program called an OP_CHECKLOCKTIMEVERIFY
  operation that requires a locktime greater than the transaction's locktime ... required locktime: <n>", not
  `TooEarly`. Other `require` checks with a custom error report the error name (for example `AlreadyMarkedPaid`).
- Cause: a `tx.time` comparison compiles to `OP_CHECKLOCKTIMEVERIFY`, which fails the script before any error branch
  runs. This is how BCH time locks work; only the reporting differs from the other checks.
- Workaround in this project: the tests match either `TooEarly` or the required locktime equal to the escrow's own
  `sellerCanCancelAfter` (`tooEarly` in `test/helpers/escrow.ts`).
- Upstream: not reported; it is a debugging aid, not a correctness issue.

## F8: a failing `require` in a constructor is reported as missing state writes

- Repro: deploy `JaminEscrow` with `initArgs` `[0, 30, 5000, <time>]`, so that `require(amount > 0, InvalidAmount())`
  in `EscrowBase.setUp` fails. `StatefulContract.deploy` throws "Failed to derive initial state commitments from
  constructor. Ensure the constructor writes all state variables. VM error at instruction 47/266: Program failed an
  OP_VERIFY operation." The custom error is not named, and the hint points at state writes, which are complete.
  The same happens for `InvalidDisputeFee` and `InvalidCancelTime`.
- Cause: `packages/solidcash/src/stateful/sc-derive-deploy-commitments.ts` builds this message from the last failing
  VM step only. Calls after deployment map the failing step to its `require` site ("failing require in
  JaminEscrow:90 (require failed: AlreadyMarkedPaid(...))"); the constructor probe does not.
- Workaround in this project: the tests match the VM failure of the constructor probe (`CONSTRUCTOR_CHECK` in
  `test/JaminEscrow.state.test.ts`); the sabotage table in `docs/MEASURED.md` shows which check each test needs.
- Upstream: no matching open issue or pull request found on 2026-11-17. A debugging aid, not a correctness issue.

## F9: a provider is asked to broadcast through two methods, and `disconnect` throws on a provider that connects itself

- Repro: wrap a `MockNetworkProvider` so that `sendRawTransaction` records each transaction, then deploy and call a
  stateful contract through the wrapper. Nothing is recorded: `TransactionBuilder.send` and the stateful submit path
  call `sendPreparedTransaction` when the provider has it and fall back to `sendRawTransaction` only when it does not.
  Separately, `new ElectrumNetworkProvider(Network.MAINNET, { hostname })` reads fine, but its `disconnect()` throws
  "Manual connection management is disabled", so a script that disconnects in `finally` fails after it has finished.
- Effect in this project: the spending gate (`src/budget/gate.ts`) gates both methods and refuses any other provider
  method whose name starts with send, broadcast, publish or submit; the mainnet script opens the Electrum provider
  with `manualConnectionManagement: true`. The test "runs branch A and records every broadcast in the ledger" in
  `tests/mainnet-context.test.ts` failed with a gate on `sendRawTransaction` alone and passes with both.
- Upstream: a documentation point (which methods a provider wrapper must cover), not a correctness issue; not
  prepared as a fix.

## F10: a wallet cannot sign a contract signature argument of a stateful call

- Repro: `test/JaminEscrow.wallet.test.ts`, "F10: the SDK refuses a call whose seller signature is a placeholder
  for the wallet to fill". A `release(sig s)` call whose `s` is what a BCH WalletConnect dapp sends for the wallet
  to fill (64 zero bytes and the sighash type) is refused before broadcast: "messageBus: BCH-2026 preflight failed at
  input 0: Program failed a signature verification with a non-null signature (violating the "NULLFAIL" rule)",
  failing require `NotSeller`. With the role key's real signature the same call passes.
- Cause: the stateful call path evaluates every contract input in the BCH-2026 preflight before it broadcasts, and
  takes a contract signature from `SignatureTemplate.generateSignature`, which is synchronous and was called 11 times
  for one `fund` call on the mock network while the fee converged. `Signer.external` (`external-signing.ts`) signs
  only a wallet's P2PKH inputs, and sends every other input to the wallet empty. So a key that a wallet holds behind
  `bch_signTransaction` can pay for a stateful call but cannot be the key a `checkSig` in the contract checks,
  although `placeholderSignature()` in `@solidcash/solidcash/walletconnect` exists for that case.
- Effect in this project: a seller trading from a wallet authorises with a role key derived from a message the
  wallet signs, and the wallet pays and signs its own inputs (`docs/decisions/0009-wallet-connection.md`).
- Upstream: related but not the same: issue #3 (the wallet's P2PKH placeholder in stateful calls, 0.50.1; it works
  in 0.51.1, see the wallet test above) and pull request #1 (the covered bytecode sent for a dispatched function of
  a plain contract). A fix needs an asynchronous signing step between the final build and the broadcast, which is
  larger than a small patch; not prepared as a fix.

## F11: a destination-pinned `selfdestruct` cannot relay once the contract's unlocking script passes about 2,000 bytes

- Repro: `npx tsx scripts/repro-close.ts`, which compiles a copy of the escrow contracts with
  `close(sig s)` ending in `selfdestruct(new LockingBytecodeP2PKH(hash160(seller)))` (decision 0013) and closes a
  released BCH escrow on the production-profile mock. With the event records left out and the fee taken from the
  transaction size: "Destroy transaction has no funds to reclaim after fees. Total inputs: 5800, fee: 7052." With a
  fee of 1,999 sats: "min relay fee not met".
- Cause: the statement form's covenant requires `sum(inputs) - outputs[0].value < 2000` (`language/selfdestruct.md`).
  The closing transaction carries the contract's unlocking script, about 7,000 bytes for this escrow, and the relay
  minimum is 1 sat per byte. No fee satisfies both. The documentation states the cap but not that it bounds the
  size of a contract that can use the statement form.
- Effect in this project: the contracts have no `close` function (decision 0013). The 41,800 sats in master, state
  and container coins of the seven mainnet escrows stay where they are, and so would about 5,800 sats of each new
  escrow: at this contract size a close would cost more in fees than it returns.
- Upstream: a documentation point, or a fee cap derived from the transaction size; not prepared as a fix.

## F12: the destroy helper spends event records whose relative lock has not passed

- Repro: `npx tsx scripts/repro-close.ts`, first case: `StatefulContract.selfdestructTo` on an escrow released in
  the same block fails with "non-BIP68-final".
- Cause: `sc-destroy.js` adds every event record at the event addresses as an input with the 144-block sequence,
  whether or not 144 blocks have passed. `language/selfdestruct.md` says unexpired event NFTs do not block master
  destruction. A finished escrow's last call always emits an event, so a close right after it always fails.
- Effect in this project: none beyond F11; the repro leaves the event records out through a provider that hides
  them.
- Upstream: the same issue is addressed by open upstream pull request #13
  (https://github.com/solidcash/solidcash/pull/13), so no duplicate was opened.

## F13: the destroy helper refuses to burn the tokens of a named token container

- Repro: `npx tsx scripts/repro-close.ts`, last case: closing a released token escrow with its token container in
  `tokenContainerCategoryIds` fails with "Implicit burning of fungible tokens for category ... is not allowed (input
  amount: 1, output amount: 0). If this is intended, set allowImplicitFungibleTokenBurn to true."
- Cause: `sc-destroy.js` builds its transaction with `allowImplicitNftBurn: true` but not
  `allowImplicitFungibleTokenBurn`, while `sdk/stateful-contracts.md` says CashTokens still in a named container are
  burned. The options of `selfdestructTo` offer no way to allow it.
- Effect in this project: none beyond F11; it would have stopped the token escrow's close (decision 0013).
- Upstream: a small fix (pass the option, or document that the container must be empty); not prepared as a fix.

## F14: the SDK leaves filler outputs that anyone may sweep, but offers no way to spend one

- Repro: `tests/filler.test.ts`. The token escrow's first deposit on mainnet (`d46f258d...`, output 3) left 576 sats
  at the filler lock; `@solidcash/solidcash` 0.51.1 exports no unlocker or sweep helper for it, so the test spends
  it through an unlocker written from the script.
- Cause: `fillerOutput` (`stateful/filler.ts`) and `fillerLockingBytecode` (`@solidcash/utils`) build the output at
  the P2SH32 lock of `<144> OP_CHECKSEQUENCEVERIFY OP_DROP OP_1`, and their comments say anyone may sweep it after
  144 blocks. Nothing in the package or in `website/docs` spends it; upstream's own `test/e2e/DrainFiller.test.ts`
  defines its own unlocker for the same reason.
- Effect in this project: `src/coins/filler.ts` writes the lock and its unlock out, and the event sweep adds the
  filler of an escrow's own transactions (the 576 sats of branch B).
- Upstream: open pull request [#15](https://github.com/solidcash/solidcash/pull/15), opened 21 November 2026. Branch `fix/filler-unlocker` on upstream `master` at `eda85a88d`
  exports `fillerUnlocker()` and `FILLER_SEQUENCE` beside `fillerOutput` from the stateful entry point, adds a line to
  `website/docs/guides/stateful-guide.md`, and has `test/e2e/DrainFiller.test.ts` use the export in place of its own
  unlocker. `packages/solidcash/test/unit/FillerUnlocker.test.ts` and the drain test fail on `master` (the export is
  missing) and pass with the change.

## Fixes submitted upstream

Four findings have a small fix with a regression test that fails on upstream `master` at `eda85a88d` and passes with
the change. F8, F1 and F4 were opened as pull requests to `solidcash/solidcash` on 18 November 2026, F14 on
21 November 2026. On 21 November 2026 at 03:35 UTC all four were open and not drafts; #8, #9 and #10 had no review
and no maintainer comment.

| Finding | Pull request | Branch | Change | Test |
| --- | --- | --- | --- | --- |
| F8 | [#8](https://github.com/solidcash/solidcash/pull/8) | `fix/constructor-require-site` | `sc-derive-deploy-commitments.ts` names the failing constructor `require` with `probeRequireStatement` | `packages/solidcash/test/e2e/ConstructorRequireSite.test.ts` |
| F4 | [#10](https://github.com/solidcash/solidcash/pull/10) | `fix/mock-provider-exact-optional` | `NetworkProvider.oraclePoolCategory` declared `?: string \| undefined` | `packages/solidcash/test/unit/MockProviderExactOptionalTypes.test.ts` |
| F1 | [#9](https://github.com/solidcash/solidcash/pull/9) | `fix/framed-locking-bytecode-instantiation` | `LowerFramedCreate2Address` and the optional-lowering survey skip the built-in locking bytecode classes | `packages/solidc/test/framed/master/locking-bytecode-instantiation.test.ts` |
| F14 | [#15](https://github.com/solidcash/solidcash/pull/15) | `fix/filler-unlocker` | `fillerUnlocker()` and `FILLER_SEQUENCE` exported beside `fillerOutput`; `DrainFiller.test.ts` uses the export | `packages/solidcash/test/unit/FillerUnlocker.test.ts` |

For F1 the direct composition is unchanged: the bytecode and ABI of the 11 upstream contract files and examples that
use a built-in locking bytecode class hash the same before and after the change. The fix lets the framed contract
compile; a framed payment to a P2PKH output was not run on a network in this project.

The others are not prepared as fixes: F2 and F5 change how calls are derived or compiled, which is larger than a
small patch and needs the maintainers' view first; F3 may be intended; F6 is fixed by open pull request #6; F7 is how
BCH time locks fail; F9 is a documentation point; F10 needs an asynchronous signing step in the SDK;
F11 and F13 were found after the pull requests were opened, and each section names the change it would take;
F12 is addressed by open pull request #13.
