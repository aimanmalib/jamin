# 0005: Web app with an in-browser simulator

Date: 2026-11-17. Status: accepted.

## Context

The bounty asks for an application whose lifecycle is usable. Mainnet escrows need a funded wallet and real blocks;
a visitor (or a judge) has neither. The contracts are already compiled to artifacts that the SolidCash SDK can run on
its mock network, and the SDK ships browser builds.

## Decision

- A static Vite + React site in `web/`, one page with hash routes (`#/try`, `#/lifecycle`, `#/contract`), so it can be
  served by any static file server and needs no backend or keys.
- **Try it** runs the compiled `JaminEscrow` and `JaminTokenEscrow` artifacts on `MockNetworkProvider` with the
  production profile in the browser (`web/sim/engine.ts`). The visitor picks a role and an action; the call is signed
  with that role's throwaway key, so a wrong role or a wrong moment is rejected by the contract itself and shown with
  its error name. The engine and artifacts load only when the tab is opened.
- **Lifecycle** reads `examples/regtest.json` (the regtest run, checked against `docs/MEASURED.md` by a unit test)
  and `examples/mainnet.json` (empty until the mainnet run). Mainnet escrow coins are read live from the configured
  Electrum server. An empty mainnet record is stated plainly on the page.
- **Contract** parses the feature table of `docs/FEATURES.md` at build time, so the page and the document cannot drift.
- Text in `lang/en.json` and `lang/ms.json` (a unit test checks the keys match and every key the components use
  exists); values (simulator amounts, tabs, contract list, explorer links) in `config/jamin.json`.
- Look: warm paper, ink, river green, one amber accent, danger red; Fraunces, IBM Plex Sans and Mono, self-hosted.
  No blur or backdrop filters.
- A call builder in the SolidCash SDK is thenable, so the engine never returns one from an async function (awaiting
  it would send the transaction).

## Consequences

- The simulator proves the contract logic and the BCH size limits of the mock, not node acceptance; the regtest and
  mainnet records cover that.
- The simulator bundle is large (the SDK and its VM); it is loaded only when **Try it** opens.
- Signing from a real wallet is not part of this decision.

## Rollback

The web app is independent of the contracts and scripts: removing `web/`, `index.html`, `vite.config.ts` and the
`vite build` step of `npm run build` returns the repository to its previous state.
