# 0023: Home stats strip from the mainnet record and a live block height

Date: 2026-11-20. Status: accepted.

## Context

A visitor of the Home page sees one sentence and a button. Nothing on the first screens says that the contracts run
on mainnet today, how much they have held, or that the network itself refused the calls the contract forbids. Those
facts are already recorded in `examples/mainnet.json`, except the amount each escrow locked: the record kept
txids, sizes and fees, not amounts.

## Decision

1. A strip under the first screen (`web/ui/StatsStrip.tsx`) shows four numbers: escrows on mainnet, coins ever
   locked, calls the network refused, and the current block with "updated N s ago".
2. The first three are counted by pure functions in `web/data/stats.ts` from `examples/mainnet.json`, bundled with
   the page. `tests/stats.test.ts` checks each against a plain count over the file, checks that adding an escrow or a
   refused call to a copy of the record changes them, and fails when the component carries a number literal of its
   own.
3. Escrows on mainnet = escrows in the record plus demo pool escrows that the host's pool list
   (`/pool/pool.json`, decision 0021) names and the record does not hold yet. The list is read once; missing or
   malformed = zero added.
4. Coins ever locked = the sum of `lockedSats` over fund steps (BCH escrows) and, on a second line and never added
   to it, the sum of `lockedUnits` over deposit steps (PUSD escrows). Both are read from the fund and deposit
   transactions on the configured Electrum server by `scripts/record-locked.ts` (`src/lifecycle/locked.ts`): for a
   BCH escrow the value of the satoshi container output, which holds amount, trade fee and container reserve; for a
   token escrow the PUSD units of the token container, which holds amount, fee unit and reserve unit. The strip
   says "locked", not "traded", for that reason.
5. Refused calls = steps marked `"refused": true` (decision 0015). The number links to the Lifecycle tab, where each
   one shows the server's text.
6. The block height comes from `blockchain.headers.get_tip` over one Electrum connection kept open while the strip
   polls every `stats.pollMs` (15000 ms, held to `stats.pollRangeMs`), not while the browser tab is hidden (the
   poller of decision 0022). A failed read closes the connection; the next poll opens a new one. While reads fail
   the recorded numbers stay and the strip says "live data unavailable", never zero. `?stats=mock` replaces the
   server with a stand-in that grows by one every `stats.mockPollMs`, for the end-to-end test.

## Consequences

- A new mainnet run must run `scripts/record-locked.ts` after it writes the record; `tests/stats.test.ts` fails
  while a fund or deposit step has no amount.
- Polling was kept over `blockchain.headers.subscribe` so one code path (the same poller as the Wallet tab) covers
  visibility and retries; a fifteen second read of the tip is light for the server.
- Undo: remove `<StatsStrip />` from `web/ui/Home.tsx`; the record fields are harmless to the other readers.
