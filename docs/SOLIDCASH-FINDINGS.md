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
- Workaround in this project: the escrow does not check the deposit in the constructor; the buyer checks the
  container balance on chain before paying.
- Upstream: no matching open issue or pull request.

## F4: `MockNetworkProvider` is not assignable to `NetworkProvider` under `exactOptionalPropertyTypes`

- Repro: with `"exactOptionalPropertyTypes": true`, passing `new MockNetworkProvider()` as `provider` to `Contract`,
  `TransactionBuilder` or `StatefulContract.deploy` is a type error: `oraclePoolCategory` is `string | undefined` on
  the mock and an optional `string` on the `NetworkProvider` interface.
- Workaround in this project: `asProvider()` in `src/sdk/mock.ts`.
- Upstream: no matching open issue or pull request. Typing only; runtime behaviour is unaffected.
