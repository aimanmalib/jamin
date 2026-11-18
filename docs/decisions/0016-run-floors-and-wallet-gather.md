# 0016: Branch funding floors and gathering the wallet to the seller

Date: 2026-11-18. Status: accepted.

## Context

Branch R (decision 0015) opens one BCH escrow on mainnet. A run starts only when the seller address holds
`mainnet.minFundingSats` (300,000, decision 0011), which is sized for branches A, C, D and E together; branch B
alone had its own floor, `tokenRunMinFundingSats` (decision 0012). After the earlier runs the wallet held 108,167
sats in total but the seller address only 30,507, while the buyer and the arbitrator kept floats they no longer needed.

Branch R's seller pays, in this order: the genesis coin each deployment spends (`mainnet.genesisCoinSats`, 50,000,
plus a 3,000 sat margin; the change returns), the escrow amount and fee with the `fund` call fee (about 28,000), and
the `release` call fee (7,415). Its peak is the genesis payment, about 53,000 sats.

## Decision

- `mainnet.branchFloorSats` replaces `tokenRunMinFundingSats`: `B` 40,000 (unchanged) and `R` 60,000. A run whose
  branches all have a floor there starts at the highest of them; any other run keeps `minFundingSats`.
- `npm run wallet -- gather` sends one wallet-internal payment: the plain coins of the other role addresses go to
  the seller, except that the buyer and the arbitrator keep half of `mainnet.partyFloatSats` each, the amount below
  which a run tops them up again. Token coins are not touched. It goes through the spending gate like every mainnet
  broadcast; the gate counts only the miner fee, because inputs and outputs are wallet addresses.
- `npm run lifecycle -- --network mainnet --branches ''` broadcasts nothing and only records the block of steps an
  earlier run left in the mempool.

## Consequences

- Branch R ran on mainnet from the coins the wallet already held, with no new funding. The budget
  (`mainnet.budgetSats`, 2,000,000) and the gate are unchanged.
- Going back: set `branchFloorSats` to `{"B": 40000}` (branch R then needs the full floor) and stop using `gather`.
