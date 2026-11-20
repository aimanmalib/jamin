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
- Way back: `deploy/demo-restage-cron.sh buang` stops restaging; the escrows already staged stay waiting.
