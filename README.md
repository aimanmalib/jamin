# Jamin

Peer-to-peer trade escrow for Bitcoin Cash, written in SolidCash.

A seller locks BCH (or a CashToken such as PUSD) in a contract. The buyer pays in fiat off chain (bank transfer, e-wallet)
and marks the trade as paid. The seller then releases the coins to the buyer. If the two disagree, either side can open a
dispute by posting a dispute fee, and a named arbitrator decides who receives the coins. Nobody holds the funds in the middle:
the contract only lets each role do what the trade rules allow, checked by signature.

Jamin is an entry for **BCH BLAZE 2026**, bounty **Best SolidCash Application**. It is a port of the MIT-licensed
`OpenPeerEscrow.sol` contract from EVM to the Bitcoin Cash UTXO model (see `NOTICE`).

## Status

Work in progress. This section is updated as each part is built and measured.

| Part | State |
| --- | --- |
| Project skeleton, SolidHat test setup, test wallet tooling | done |
| Escrow contracts and SolidHat tests (lifecycle, rejections, payout checks) | done |
| Regtest run with real consensus limits (stock BCHN node, five branches) | done, see `docs/MEASURED.md` |
| Mainnet lifecycle run | not started |
| Web app (English and Bahasa Melayu): in-browser simulator, recorded runs, contract view | built, not yet deployed; see `docs/MEASURED.md` |

Claims about mainnet runs, script sizes and test counts appear here only after they are recorded in `docs/MEASURED.md`.

## Lifecycle (target)

1. `createEscrow`: the seller locks the coins with the buyer, arbitrator, fee and waiting time fixed in the contract.
2. `markAsPaid`: the buyer confirms the fiat payment. From here the seller can no longer cancel.
3. `release`: the seller sends the coins to the buyer, minus the fee in basis points to the fee recipient.
4. `buyerCancel`: the buyer can cancel at any time before release; the coins return to the seller.
5. `sellerCancel`: the seller can cancel only after the waiting time and only if the trade is not marked as paid.
6. `openDispute`: after payment is marked, either side opens a dispute and posts the dispute fee.
7. `resolveDispute`: the arbitrator picks the winner; the winner's dispute fee returns, the loser's goes to the fee recipient.

## Development

Requires Node 22.

```sh
npm ci
npm run solidhat:test   # compile the contracts and run the SolidHat tests on the mock network
npm run gate            # lint, types, SolidHat tests, unit tests, build
```

Project values (network, Electrum server, token category, fees, waiting time, spending budget) live in `config/jamin.json`.
User interface text lives in `lang/en.json` and `lang/ms.json`. Decisions are recorded in `docs/decisions/`.

### Regtest run

Runs the five lifecycle branches (BCH release, token release, buyer cancel, seller cancel after the waiting time,
dispute and resolution) on a throwaway Bitcoin Cash Node in Docker with stock limits. Needs Docker and `jq`.

```sh
bash scripts/regtest-node.sh start
npm run lifecycle -- --network regtest
bash scripts/regtest-node.sh stop
```

### Web app

The app in `web/` (Vite, React) has four tabs: a home page, **Try it** (the compiled contracts running on the
SolidCash mock network inside the browser, where you act as seller, buyer, arbitrator or someone else and see each
transaction or the contract's named error), **Lifecycle** (the state machine and every recorded run from
`examples/`), and **Contract** (the sources with the feature table of `docs/FEATURES.md`).

```sh
npm run build        # compile the contracts, then build the static site into dist/
npm run e2e          # Playwright: Chromium desktop and WebKit iPhone 13 against vite preview
```

### Test wallet

The lifecycle scripts use a test wallet of their own. Every role (seller, buyer, arbitrator, fee recipient) is a different
HD path of the same phrase, so funds stay inside the test wallet.

```sh
npm run wallet -- init      # create .env with a new phrase (mode 0600); refuses if .env already has one
npm run wallet -- address   # print the receive address and its balance
```

The scripts never print the phrase or any private key. Every mainnet broadcast goes through a spending budget
(`mainnet.budgetSats` in `config/jamin.json`) and refuses before broadcasting when the budget would be exceeded.

## AI disclosure

The code and documents in this repository were written by an AI coding agent. The project owner chose the problem, set the
rules the agent works under and reviews the result.

## License

MIT, see `LICENSE`. Third-party attribution is in `NOTICE`.
