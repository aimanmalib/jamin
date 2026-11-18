# 0017: Accounting for the coins finished escrows leave behind

Date: 2026-11-18. Status: accepted.

## Context

Each finished mainnet escrow kept about 11,000 sats in coins at its contract addresses. Before writing a function that
closes an escrow (decision 0013, planned), we needed to know which of those coins any existing path can spend, and
whether every satoshi of the test wallet is accounted for. Calling the entry points against the real network does not
answer the question: the SDK first splits the caller's coins into fee coins and broadcasts that split, so most calls
stop before the contract is evaluated, and a call that passed would be broadcast.

## Decision

- `scripts/contract-coins.ts` lists every coin at every address of each escrow in `examples/mainnet.json`: the
  addresses the stateful contract names (master, state, satoshi and token containers, one per event), the category's
  metadata identity, and any other output the escrow's own transactions paid outside the wallet. Coins at an address
  that is not the contract's count only when one of the escrow's transactions created them.
- The entry points are tried on a mirror: a mock network that holds exact copies of the contract's coins as the chain
  lists them, made-up fee coins for each party, and the chain's median time past. Transactions the mirror lacks are
  read from the chain. A refusal is recorded as the SDK reports it, on one line, without links.
- Branch W's seller key came from a wallet signature over a trade named after the median time past of the run. The
  script derives it again for the tips before the deployment block and keeps the one whose contract sits at the
  recorded address.
- `--claim` spends, through the spending gate, what has a path: event records whose 144-block relative lock has
  passed (swept to the seller), and each category identity (burned by its owner, the seller's lock). `--early
  <branch>` sends one escrow's event sweep before its lock passes, to record the network's refusal.
- The wallet is accounted for from the history of its six addresses: funding received, payments to other parties
  (the Cauldron pools), miner fees, coins left at contract addresses, and what the wallet holds now. The difference is
  reported, and is 0.

## Consequences

- `docs/MEASURED.md` "Final state" records the per-escrow table, the result for each kind of coin, and the wallet
  total. The gate's ledger overstates the true cost, because it never credits payouts back; both figures are shown.
- Burning an identity ends the category's metadata record. These escrows publish no registry, so nothing is lost; the
  burn returns 78 sats net per escrow.
- 41,800 sats in master, state and container coins have no path with these contract builds. A close function helps
  new escrows only.
- Undo: the script is read only without `--claim` or `--early`; deleting it changes nothing on chain.
