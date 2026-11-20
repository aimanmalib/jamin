# 0020: A public demo escrow a visitor can release

Date: 2026-11-19. Status: accepted; the single escrow became the first member of a pool in
`0021-demo-escrow-pool.md`.

## Context

The simulator shows every branch on a mock network, and the Lifecycle tab lists escrows the project ran on mainnet.
Neither lets a visitor make a mainnet transaction without a wallet. A visitor who presses one button and sees their
own release on a block explorer learns more than one who reads a txid list.

A mainnet transaction needs a key. Giving a page a key that matters is not an option, so the key has to be one that
does not matter: published, unrelated to any wallet, and guarding so little that losing it costs nothing.

## Decision

1. `scripts/demo-keys.ts` makes five keys (seller, buyer, panel A, B, C) from 32 random bytes each, using the
   platform's secure generator, and writes them as hex to `config/demo.json` with a label that says they are public.
   They are not HD children of the project's test wallet: an unhardened child key plus the parent's extended public
   key gives away the parent, so no wallet path is used at all. The fee recipient is the test wallet's existing
   fee address (a public key hash only).
2. `config/demo.json` also holds the amounts: `escrowSats` (the trade amount), `feeCoinSats` (the plain coins left
   at the demo seller for the release fee, one per funder slot the SDK fills), the coins that pay for staging, and
   `maxSats`, the most the demo keys can ever spend. `maxSats` is 24,000 sats (about USD 0.05 at the rate measured
   in `docs/MEASURED.md`). `validDemoConfig` refuses a config where the trade amount, its trade fee and the fee
   coins add up to more, and staging measures what the demo addresses hold afterwards and refuses again
   (`ExposureError`).
3. Staging (`src/demo/stage.ts`, run by `scripts/demo-escrow.ts`) creates, funds and marks the escrow paid with the
   demo keys. The project wallet pays the coins in. Everything the demo keys hold afterwards beyond the escrow goes
   back to the project wallet, then the seller gets only its fee coins. On mainnet every broadcast goes through the
   spending gate (decision 0007); that run is a separate step.
4. The page's "Release on mainnet" card (`web/ui/DemoRelease.tsx`, `web/demo/run.ts`) reads the escrow's state from
   the configured Electrum server. When the buyer has marked it paid, the button signs `release` in the browser with
   the demo seller key (`src/demo/escrow.ts`, the same module the script uses on regtest) and broadcasts it. Once
   released, the card shows the escrow's latest transaction instead. One press ends the demo; nothing restages it
   automatically.
5. `?demo=dry` builds and signs the release and stops at the provider: the transaction is never sent
   (`dryProvider`). Tests and the project's own checks use dry or mock (`?demo=mock`, which stages on the mock network
   in the page). The builder never presses the live button.

## What a published key can do

Anyone can take the keys from the repository. With them they can release the escrow to the demo buyer (what the
button does), cancel it as the buyer back to the demo seller, or spend the seller's fee coins and, after a release,
the buyer's coins. All of it is bounded by `maxSats`. They cannot touch the test wallet: no demo key is derived from
it, and the test wallet signs nothing during a visitor's release. A dispute needs a dispute fee and two calls, so the
card does not offer it; the simulator covers that path.

## Measured

`docs/MEASURED.md` `## Demo escrow`: staging and release on the mock network with the production profile and on a
stock BCHN regtest node. The dry release's txid equals the txid of the release sent afterwards, so the dry mode shows
exactly the transaction a press would send.

## Rollback

Hide the card by removing the `demo: true` escrow from `examples/mainnet.json` (the card then says the demo escrow is
not on mainnet), or roll the site back with `deploy/deploy.sh --rollback`.
