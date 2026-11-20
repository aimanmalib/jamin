# 0022: Wallet tab with a QR code, a header balance chip and live status

Date: 2026-11-19. Status: accepted.

## Context

The Wallet tab (0014) showed the WizardConnect link as a text field to paste into a wallet, and the seller pressed
"Check for the buyer's payment" to see whether the escrow had turned from funded to paid. A phone wallet scans a QR
code more easily than it takes a pasted link, a refresh button asks the visitor to do the page's work, and the only
sign of a connected wallet was inside the tab.

## Decision

1. The link is drawn as a QR code (`qrcode-generator` 2.0.4, MIT, already used for the slides) in one SVG path, with
   the full link as text under it and a "Copy link" button. Tapping the code copies the link too. A short
   "Copied" note (`role="status"`) shows for `walletTrade.copiedMs`. Copying uses the Clipboard API and falls back to
   a hidden text area for browsers that refuse it.
2. A wizard's hat, drawn for this site (`web/ui/WizardHat.tsx`; the WizardConnect packages ship no logo to copy),
   marks WizardConnect on the connect button, the QR box and the header.
3. The header has a "Connect wallet" link at the top right on every tab. Once a wallet connects it shows the
   balance of the wallet's `receive/0` address in BCH, and PUSD units when there are any, read from the configured
   Electrum server. The connected wallet lives in a small store (`web/wallet/store.ts`) holding the address and a
   balance reader, never a key. The Wallet tab stays mounted, hidden, after it is first opened, so the trade and the
   chip survive a visit to another tab. On phones the chip is the hat alone until a wallet connects, which keeps the
   header on one row (checked in `e2e/wallet.spec.ts`); once connected it shows the BCH amount alone and may take a
   row of its own on a narrow phone.
4. There is no refresh button. The escrow status (while funded) and the balance are read every
   `walletTrade.pollMs` (5000 ms), held to `walletTrade.pollRangeMs`, one read at a time, and not while the browser
   tab is hidden. Polling was chosen over `blockchain.scripthash.subscribe`: the status is a field of the escrow's
   state coin, which the SDK reads through its own provider, and a five second read of one address is light for the
   server.
5. For tests, `?wallet=mock` in the page URL swaps the relay for a stand-in wallet in the page
   (`web/wallet/mock.ts`): the test accepts the connection, the balance is fixed and the escrow turns paid after a
   few status reads. Nothing is signed or sent in that mode, as with `?demo=mock` (0020).

## Consequences

- The end-to-end test `e2e/wallet.spec.ts` covers the QR, copying, the chip, the status turning paid without a click
  and the 320 px layout in Chromium and WebKit on an iPhone 13 profile; `tests/wallet-header.test.ts` checks the QR
  modules against the library, copying, the polling and the balance sums.
- A visitor with the tab open makes one Electrum request per five seconds for the balance and one for the status.

## Way back

Set `walletTrade.pollMs` to the top of its range to read less often, or revert the commit: the trade code in
`web/wallet/trade.ts` is unchanged apart from the `TradeApi` interface it now implements.
