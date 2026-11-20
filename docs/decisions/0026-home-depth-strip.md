# 0026: Home depth strip counted from the repository

Date: 2026-11-20. Status: accepted.

## Context

The bounty asks for a SolidCash application whose focus is the smart contract. The Home page showed what the
contract has done on mainnet (decision 0023) but not what stands behind it: which SolidCash features it uses, how many
SolidHat tests run against it, what building it found in SolidCash and sent upstream, and that it is a port of an
existing Solidity escrow. Those facts live in repository files; a number typed into the page would drift from them.

## Decision

1. A strip right under the hero (`web/ui/DepthStrip.tsx`), above the stats strip, shows four facts, each a link:
   SolidCash features used (to the Contract tab), SolidHat tests (to `test/`), SolidCash findings and the pull
   requests sent upstream (to the findings document and the README section), and scenarios run on mainnet with
   their transactions (to the Lifecycle tab). A second line links the porting note: "Ported from OpenPeerEscrow
   (Solidity, EVM)".
2. Every number is counted by pure functions in `web/data/depth.ts` from files the build imports: rows of the table in
   `docs/FEATURES.md`; cases in `artifacts/solidhat-tests.json`; `## F<n>` headings in
   `docs/SOLIDCASH-FINDINGS.md`; `config/jamin.json` `depth.upstreamPrs`; and `examples/mainnet.json`.
3. The SolidHat test list is collected by running the test files (`vitest list --staticParse=false`, in
   `scripts/solidhat-list.ts`), because several tests are made in loops and a count of `it(` in the source gives 91
   where 103 run. The list is committed; the gate runs `scripts/solidhat-list.ts --check` after the SolidHat tests
   and fails when the list no longer matches the test files.
4. Scenarios = distinct branch labels in `examples/mainnet.json` other than demo pool escrows (`"demo": true`);
   transactions = distinct txids those escrows record. The word is "scenarios", not "branches", because the labels
   include the refused-call run and the wallet-signed and relayed runs, not only the five lifecycle branches. The
   definition is also in `docs/MEASURED.md` "Depth strip".
5. Upstream pull requests = only those this project opened, listed in `depth.upstreamPrs`. A pull request by someone
   else that addresses one of the findings is not counted.
6. `tests/depth.test.ts` counts each number again another way from the same files, checks that each listed pull
   request is a bullet of the README section and is linked from the findings, that the test list names every test
   file and every plain test title, that README and `docs/MEASURED.md` state the same test count, and that the
   component and the counting module carry no number literal.

## Consequences

- Adding or renaming a SolidHat test needs `npx tsx scripts/solidhat-list.ts` and a commit of the list; the gate says
  so when it is forgotten.
- Links to repository files are GitHub links and answer 404 while the repository is private.
- Undo: remove `<DepthStrip />` from `web/ui/Home.tsx`; the list file and the gate step are harmless on their own.
