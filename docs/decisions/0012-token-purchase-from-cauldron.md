# 0012: Buying the branch B token from Cauldron pools

Date: 2026-11-18. Status: accepted.

## Context

Branch B (the token escrow) needs PUSD in the seller address of the test wallet before a mainnet run. The wallet holds
BCH only. Cauldron pools hold PUSD on chain and trade it against BCH with a constant-product rule and a 0.3% fee.
Measured on 2026-11-18 from the public pool list: 58 PUSD pools, about 4,820 sats per unit (0.01 PUSD), so 1.00 PUSD
costs about 482,000 sats, more than the wallet holds after the BCH branches (see `docs/MEASURED.md`).

## Decision

- `scripts/buy-token.ts` buys exactly the units branch B deposits (amount, fee, and the unit that stays in the token
  container) minus what the seller already holds. Trade maths and the transaction come from `@cashlab/cauldron` 1.0.3
  (ISC), a dev dependency used by this script only.
- The pool list comes from the indexer in `mainnet.tokenPurchase.indexerUrl`. It is treated as data: each pool is
  kept only when the output in the transaction that created it, read from the Electrum server, has the Cauldron
  locking bytecode for its owner and the satoshis and token amount the indexer listed (`src/swap/cauldron.ts`).
- The library's script VM check runs on the finished transaction; a transaction that would burn tokens is refused.
  The script refuses more than `tokenPurchase.maxUnits` (200 = 2.00 PUSD) or a price above `maxSupplySats`.
- Without `--send` it prints the quote only. With `--send` the transaction goes through the same spending gate and
  ledger as the lifecycle run, to a configured broadcast host only.
- `mainnet.tokenAmount` is 10 (0.10 PUSD), so the purchase is 12 units (about 58,000 sats). A run of branch B alone
  starts at `mainnet.tokenRunMinFundingSats` (40,000) instead of `minFundingSats`, which is sized for the BCH branches
  (0011); the budget gate is unchanged.

## Consequences

- The escrow on mainnet trades 0.10 PUSD. The contract does not depend on the amount; the regtest run trades 2.00.
- `@cashlab/common` brings its own copy of libauth (3.1.0-next.6); the rest of the code keeps libauth 3.0.0.
- Going back: remove the script and the dependency, set `mainnet.tokenAmount` back to 100, and drop
  `tokenRunMinFundingSats` and `tokenPurchase` from `config/jamin.json`.
