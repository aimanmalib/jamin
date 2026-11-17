# 0004: Regtest proof on a stock BCHN node

Date: 2026-11-17. Status: accepted.

## Context

The SolidHat tests run on the SolidCash mock network. The mock is configured with BCH size limits, but it is not a
node: it does not prove that real nodes accept and relay the transactions. Mainnet runs cost real coins and wait
for real blocks, so the full lifecycle needs a node-level rehearsal first.

## Decision

- `scripts/regtest-node.sh` starts the stock `mainnet/bitcoin-cash-node:v29.0.0` image (the version the SolidCash
  repository uses for regtest), not its relaxed build. The image and port are in `config/jamin.json` `regtest`.
- The node runs with `-acceptnonstdtxn=0`. BCHN regtest accepts non-standard transactions by default, and mainnet
  nodes do not, so without the flag a too-large or otherwise non-standard transaction could pass on regtest and
  fail on mainnet.
- `-upgrade12activationtime=1690000000` activates the May 2026 network upgrade from the first block, matching
  mainnet where it is already active.
- The chain lives in tmpfs, the container is limited to one CPU and removed on stop. Every run starts from an
  empty chain, so no state is carried between runs.
- `scripts/lifecycle.ts` drives the run through `RegtestNetworkProvider` from `@solidcash/solidcash`. The parties
  are derived with the project's own key code from a phrase generated for the run and never written anywhere;
  the mainnet test wallet is not used on regtest.
- The five branches live in `src/lifecycle/` and read only a small context (provider, parties, terms, a way to
  let time pass), so the mainnet run can reuse them with a different context.

## Consequences

- Each run writes its raw output (transaction ids, sizes, heights) to `state/regtest/`, which is not tracked; the
  numbers used in documents are copied into `docs/MEASURED.md`.
- Regtest coins have no value, so the run is free; it does not prove fee rates or relay on the public network.
- Rollback: the run is a script with no effect on the contracts; removing it leaves the tests unchanged.
