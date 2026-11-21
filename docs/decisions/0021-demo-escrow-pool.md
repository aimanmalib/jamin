# 0021: A pool of demo escrows, restaged by a host cron

Date: 2026-11-20. Status: accepted. Amends decision 0020 (one demo escrow, staged again by hand).

## Context

Decision 0020 put one public demo escrow on mainnet. The first visitor who presses "Release on mainnet" ends the
demo for everyone after them: the card then shows an escrow that is already released. Staging again by hand needs a
person at the right time. The owner set a cap for keeping the demo alive: less than USD 0.30 in total.

## Decision

1. **Pool.** `config/demo.json` `pool` keeps `size` escrows waiting at `paid` (3), with `budgetSats` 145,000 (USD
   0.30 at the rate measured in `docs/MEASURED.md`, about 4,835 sats per 0.01 PUSD, rounded down), no staging from
   `restageUntil` (2026-12-15) and at most `maxIndex` (40) escrows ever staged. The escrow staged under decision
   0020 is the pool's first member; its cost is not in this budget.
2. **Size from the measured cost.** Staging one escrow on the SolidCash mock network with the production profile
   (the same transaction sizes as mainnet) cost 41,406 sats: what the wallet pays the demo keys, less the change
   that comes back, plus 400 sats counted for each wallet payment. `estimateSats` is 42,000. Filling the pool from
   the first member takes two stagings, 84,000 sats, under 60% of the budget, which leaves room to restage. Each
   staging after the first counts at the dearest one measured, if that is more than the estimate.
3. **Budget is net.** `spentSats` adds each staging's cost; `sweptSats` adds what the pool takes back from the demo
   keys (a visitor's release pays the trade amount to the public demo buyer key; the seller key keeps change from
   its fee coins). Staging stops when `spentSats - sweptSats` plus the next cost would pass `budgetSats`. The
   project's spending gate (decision 0007, 2,000,000 sats) still counts every mainnet payment in full.
4. **Finding the escrows.** An address computed from the public parameters alone is not possible: the SDK bakes the
   escrow's token category, the txid of the coin its deployment spends, into the locking bytecode, so the address is
   known only after the deployment. The fallback the plan allowed is used: the restage script writes the list of
   pool addresses to `state/demo-public/pool.json`, a folder `deploy/compose.yaml` mounts read-only at
   `/srv/jamin/pool/` (the folder, not the file: a single-file bind keeps the old file after a rename). nginx serves
   `/pool/` with `no-store`. The list is only an index: the page reads each escrow's status from the chain
   (`web/demo/pick.ts`), offers the first still at `paid`, and after a sent release points to the next one. A
   missing or malformed list means only the escrows recorded in `examples/mainnet.json` are offered.
5. **Restage.** `scripts/demo-restage.ts` (logic in `src/demo/pool.ts`) counts the escrows waiting. With fewer than
   `size`, before `restageUntil` and within the budget, it sweeps the demo keys' coins back to the project wallet,
   keeping at the demo seller the largest `3 x waiting` coins (the release fee of the escrows still waiting), then
   stages new escrows through the same `stageDemo` as decision 0020. Staging now leaves coins the demo keys held
   before alone and checks `maxSats` against what this staging added, so each escrow still exposes at most 24,000
   sats. The ledger is `state/demo-pool.json`, not tracked; the script never writes a tracked file.
6. **Cron.** `deploy/demo-restage-cron.sh pasang` installs one crontab line tagged `# jamin-demo-restage` that runs
   every 10 minutes with `flock -n`, `nice` and `timeout 600`. The Node binary and the warning command come from
   `deploy/hos.env` (`NODE_BIN`, `NOTIFY_CMD`), because cron's `PATH` may hold an older Node. `--kering` counts and
   plans without sending or writing. The way back is `deploy/demo-restage-cron.sh buang`.
7. **Warnings.** One warning when the budget is used up, the end date is reached or `maxIndex` is hit, and one after
   three failed runs in a row (again only after a run succeeds). No periodic messages.
8. **Never released by the project.** The script refuses `--release-first` on mainnet. Tests release on the mock
   network and on regtest only; mainnet is checked with `--kering`.

## Why public keys stay safe with several escrows

Every pool escrow uses the same five public keys, so whoever presses can release any waiting escrow, and anyone can
take what the demo buyer key receives. That is the point of a public demo. What can be lost is bounded: at most
`size` escrows wait at once, each exposing at most `maxSats`, and the pool never spends more than `budgetSats` net.
The keys guard nothing else and are unrelated to any wallet (decision 0020).

## Consequences

- The site keeps offering a mainnet release for about as many visitors as the budget allows: the first member, two
  stagings to fill the pool, then one or two restagings depending on how much is swept back.
- After the budget or the end date, the card shows the newest escrow, already released, with its transaction.
- The container gains one read-only bind; `deploy/deploy.sh` creates the folder first so Docker does not make it
  as root.
- A wallet too short to pay for a staging ends the run as waiting for funds: no failure counted, no warning, the
  public list still written. A failure after some escrows were staged keeps those in the ledger.
- Way back: `deploy/demo-restage-cron.sh buang` stops restaging; the escrows already staged stay waiting.

## Amendment, 2026-11-20: a larger budget, the sweep measured, the card's next-escrow line

- **Budget.** The owner allowed the pool to keep the demo alive through the judging week. `budgetSats` is now the
  smaller of a formula and a hard cap of 400,000 sats: the 76,812 already spent, plus 40 cycles at the net cost of
  one cycle measured on regtest (36,591 sats: a staging of 41,406 less the 4,815 the next run sweeps back), plus one
  gross staging (41,406). The formula gives 1,581,858, so the cap applies: 400,000. That leaves room for about
  eight cycles after the first three escrows (`docs/MEASURED.md` "Demo pool"). The project's own spending gate and
  its 2,000,000 sat budget are unchanged.
- **The sweep is proven before mainnet needs it.** On regtest and on the mock network a test releases one escrow,
  and the next restage sends what the release paid the demo buyer back to the project wallet, records the sweep in
  the ledger and keeps the fee coins the escrows still waiting need. Mainnet has not swept yet because no demo
  escrow there has been released.
- **The list file says when the cron ran.** `/pool/pool.json` now carries `lastRunAt`, `everyMinutes` (from
  `pool.restageEveryMinutes`, the same value `deploy/demo-restage-cron.sh pasang` writes into the crontab line) and
  `closed` (no later run could stage: budget, end date or escrow limit). When no demo escrow waits, the card says
  "ready in about N min": the minutes to the next run plus `pool.estimateReadyMinutes`, the time one run takes to
  stage. If the last run is older than three intervals the card gives no number, because the cron may have stopped.
- **Releases on mainnet.** The stats strip counts the release steps `examples/mainnet.json` records, plus demo
  escrows seen released on the chain (read while the page is open) or released by this page, so a visitor's release
  shows at once.

## Amendment, 2026-11-20: closed while the wallet cannot pay

- The funding request for the judging week came back short: the wallet held 12,730 sats, and one staging needs
  46,000 at the seller. `budgetSats` stays 400,000 (it is a ceiling, not money in hand); what the wallet holds is
  the real limit (`docs/MEASURED.md` "Demo pool on mainnet").
- A run that finds the wallet too short to stage writes `closed: true` to `/pool/pool.json`, so once every demo
  escrow is released the card says the pool is closed instead of promising an escrow in N minutes that no run can
  stage. The next run that can stage again writes `false`. Waiting for funds still sends no warning.
- Way back: drop the extra argument to `poolIndex` in `scripts/demo-restage.ts`.

## Amendment, 2026-11-20: the sweep no longer waits for staging money

- The first visitor release on mainnet showed two faults the regtest runs had not reached, because there the wallet
  always had enough to stage. (1) The run opened the project wallet with the staging amount as its floor before it
  swept, so a wallet too short to stage never got the demo keys' spare coins back. The sweep now opens the wallet
  with a floor of 0; staging opens it again with its own floor. (2) Gathering the role addresses' coins at the
  seller could pick a coin only a little above dust; the fee took all of it, the transaction had no output left and
  the server refused it ("transactions must have at least one output"). The gather now sends nothing in that case.
- Tests: `tests/gather.test.ts` builds the gather on the mock network (red on the old code), and the next cron run
  on mainnet swept 4,815 sats back (`docs/MEASURED.md` "Demo pool on mainnet").
- Way back: give `payer` no argument again in `scripts/demo-restage.ts` and drop the output check in
  `src/wallet/gather.ts`.

## Amendment, 2026-11-21: why the pool is closed

- `closed: true` meant two different things: the wallet is too short to stage (the cron stages again by itself
  once the wallet is restocked) and the pool is over (budget used up, past `restageUntil`, escrow limit). The card
  said "the pool is closed" for both, which is wrong in the first case.
- The cron now also writes `closedReason`: `funds`, `budget`, `ended` or `limit` (`src/demo/closed-reason.ts`).
  A final stop wins over a short wallet, because money in the wallet would not open a pool that is over. `closed`
  stays, so an older site still reads the file; an older file without the field keeps the old line.
- With `funds`, the card says: "The next demo escrow will be staged when the project's demo wallet is restocked.
  The recorded mainnet releases are in Lifecycle." (`demo.poolRestock`, English and Malay). It explains and does not
  invite: no address, no request to send anything. Restocking is the project's job, through its own funding.
- Funding target for 23-27 Nov: six cycles at the measured net cost plus one staging, less what the wallet holds,
  capped by what is left of `pool.budgetSats` and by the shared wallet's single-transfer limit (`docs/MEASURED.md`
  "Second funding request"). `pool.budgetSats` stays 400,000.
- Tests: `tests/demo-pool.test.ts` (the reason for each stop, and the card's reading of it), `e2e/demo.spec.ts`
  (the restock line at 320 px, Chromium and WebKit iPhone 13).
- Way back: drop `closedReason` from `poolIndex` in `src/demo/pool.ts` and `PoolLine`'s reason fetch in
  `web/ui/DemoRelease.tsx`; the card falls back to "the pool is closed".

