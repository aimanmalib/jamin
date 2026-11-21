# 0027: The connected wallet's balance and coins come from all its addresses

Date: 2026-11-21. Status: accepted. Amends 0014 (which address pays) and 0022 point 3 (which balance the chip shows).

## Context

The Wallet tab read a WizardConnect wallet's balance from its `receive/0` address only, and paid every step from that
address. Wallets spread coins over many addresses, such as change addresses and later receive addresses, so a wallet
with money showed a balance of zero and could not create an escrow, with an error that named an address of the
wallet. A visitor could read that as the page asking for coins. The page must show a wallet's real balance, say
plainly when a wallet is empty, and never ask for coins to be sent to it.

## Decision

1. **Scan.** When a wallet connects, `src/wallet/scan.ts` walks its `receive` and `change` chains from the keys the
   wallet shared in the session (`getPubkey(childIndexOfPathName(path), i)`; a chain the wallet did not share,
   `hasPath` false, is skipped). The module is pure: keys and chain access come in as functions, so the same code runs
   against Electrum in the page and against fakes in the tests.
2. **Gap limit, "used" = history.** A chain ends after `walletTrade.scan.gapLimit` (20, BIP44 and Electrum practice)
   addresses in a row that have never had a transaction (`blockchain.address.get_history`). An address that received
   and spent again still counts as used and moves the window on. `walletTrade.scan.maxAddresses` (200) caps the whole
   scan; `batchSize` (10) is how many addresses one round asks about. One Electrum connection serves a scan; the server
   is `electrum.mainnet` as before. A coin past the gap window is not found; that is the standard limit, written into
   `tests/wallet-scan.test.ts`.
3. **Balance = sum.** The header chip and the Wallet tab show the total BCH (and PUSD) over every used address. A poll
   passes the last result back in, so addresses already known as used need no history query again; the gap window
   after them is asked again.
4. **Pay from one address.** Each step (create, deposit, release) is paid from the one address that holds enough: for
   the creation an address with a plain output-0 coin of at least `minGenesisCoinSats` (the token genesis spends one);
   for the deposit the amount plus the escrow fee plus `walletTrade.scan.payerFeeMarginSats`; for the release that
   margin. The SDK's `Signer.external` is built for that address and its change returns there. The sign request names
   each input at its own path (`inputPaths: [i, 'change', 2]`), and the adapter checks each signature against the key
   of that input's address. Gathering coins from several addresses into one transaction is not built: when no single
   address holds enough, the tab says how much the wallet holds in all and at most at one address, and suggests sending
   the coins to yourself inside the wallet app. No new dependency was added; no existing library joins WizardConnect
   paths with the SDK's external signer over many addresses, so this is a small adapter of our own.
5. **Role key unchanged.** The role key request is still signed at `receive/0` with the same message (0009, 0014):
   the same wallet and trade name give the key they gave before, so existing escrows can still be resumed. A test pins
   the key the earlier code derived for a fixed wallet and trade.
6. **Empty wallet.** When the scan finds no coins, the tab shows "This wallet has no BCH at the addresses we checked"
   with the number of addresses checked and a "Try the demo without a wallet" button to the simulator (`#/try`); Create
   is disabled. Raw errors shown to the visitor have addresses taken out, and a shortfall from the SDK becomes plain
   text (`web/wallet/failure.ts`). No text asks for coins to be sent to this page, and the page has no deposit address.

## Consequences

- A connection now costs one scan: for a wallet with eight used receive addresses about 56 Electrum requests and a
  few seconds (docs/MEASURED.md). Polling waits for one scan to end before the next.
- The address shown in the tab is the wallet's own address that pays the next step, labelled as such.
- Undo: `bash deploy/deploy.sh --rollback` returns to the previous image; reverting the commit returns to `receive/0`.
