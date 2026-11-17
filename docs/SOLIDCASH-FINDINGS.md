# SolidCash findings

Issues met while building this project. Versions: `@solidcash/solidc` and `@solidcash/solidcash` 0.51.1, upstream
`master` at `eda85a88d`. Reproductions: `npx tsx scripts/repro-findings.ts` (sources in `test/fixtures/findings/`).
Upstream status was checked against open issues and pull requests on 2026-11-17.

## F1: framed composition refuses `new LockingBytecodeP2PKH(...)` as if it created a child contract

- Repro: `test/fixtures/findings/FramedLockingBytecode.scash` (a stateful contract that pays
  `this.transfer(new LockingBytecodeP2PKH(to), 1000)`). It compiles with `composition: 'direct'`. With
  `composition: 'framed'` it fails with `FRAMED_CODEGEN_UNAVAILABLE: 'new LockingBytecodeP2PKH()' takes its address
  from the creator's nonce, which a framed master does not hold; create the child with a salt`. So a framed contract
  cannot pay a P2PKH output this way.
- Cause (reading the source): the framed create-address lowering treats every instantiation node as `new C()`,
  including the built-in locking bytecode constructors.
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

## Fixes prepared for upstream

Two findings have a small fix with a regression test that fails on upstream `master` at `eda85a88d` and passes with
the change. They are prepared as branches and have not been submitted yet.

| Finding | Branch | Change | Test |
| --- | --- | --- | --- |
| F8 | `fix/constructor-require-site` | `sc-derive-deploy-commitments.ts` names the failing constructor `require` with `probeRequireStatement` | `packages/solidcash/test/e2e/ConstructorRequireSite.test.ts` |
| F4 | `fix/mock-provider-exact-optional` | `NetworkProvider.oraclePoolCategory` declared `?: string \| undefined` | `packages/solidcash/test/unit/MockProviderExactOptionalTypes.test.ts` |

The others are not prepared as fixes: F1, F2 and F5 change how calls are derived or compiled, which is larger than a
small patch and needs the maintainers' view first; F3 may be intended; F6 is fixed by open pull request #6; F7 is how
BCH time locks fail.
