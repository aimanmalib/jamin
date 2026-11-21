# 0028: A wallet that ends the session is noticed

Date: 2026-11-21. Status: accepted. Amends 0014 (the WizardConnect session) and 0022 (the header chip).

## Context

The Wallet tab listened for the WizardConnect `disconnect` event only while it waited for the wallet to connect. Once
the wallet was ready, nothing listened: when the visitor ended the session from the wallet, or the wallet went away,
the header chip still showed a balance and the buttons still looked usable. A sign request sent after that waited with
no answer. A wallet that ends the session must be noticed within seconds, and a short drop of the relay must not be
mistaken for an ended session.

## Decision

1. **Use the library's events, no new dependency.** `@wizardconnect/dapp` 0.2.8 already pings the wallet every 10 s,
   emits `reconnecting` when the relay drops or no answer came for 75 s, sends `walletready` again when the wallet
   comes back, and emits `disconnect` 8 s after the wallet says it is leaving (a grace for wallets that reconnect
   straight away). `web/wallet/link.ts` listens to these after the wallet is ready and turns them into one state:
   `connected`, `reconnecting` or `ended`. It is free of SDK imports and tested with a fake manager
   (`tests/wallet-disconnect.test.ts`).
2. **Grace from config.** A reconnect that lasts longer than `walletTrade.reconnectGraceMs` in `config/jamin.json`
   (45,000 ms) ends the session. `walletready` within the grace returns to `connected`; the keys the wallet shares are
   read from the session again on the next scan, so nothing else has to reload.
3. **Ending closes everything.** On `ended` the session sends a courtesy disconnect, stops the manager and closes the
   relay. A sign request still waiting fails at once with `SessionEnded`, which the tab shows as language text that
   says the step may still appear on chain if the wallet signed anyway (the library's own note: the outcome of a
   cancelled request is unknown).
4. **What the visitor sees.** `reconnecting`: the chip reads "Reconnecting...", the tab shows why, and the escrow
   buttons and status polling pause. `ended`: the chip goes back to "Connect wallet", the tab says "Your wallet ended
   the connection. Your escrows are safe on chain; connect again to continue." with **Connect again**, and the escrow
   card stays. Connect again opens a new session with the same trade name; the role key request is unchanged
   (`receive/0`, same message, decisions 0009, 0014, 0027), so the same wallet gives the same seller key and an escrow
   made earlier continues through `resume`.
5. **Connect timeout.** A wallet that does not connect within `walletTrade.connectTimeoutMs` closes the session; the
   tab says the link expired and the button reads **Try again**.
6. **Test hook in the stand-in only.** `?wallet=mock` gains `window.jaminWalletMock.drop('ended' | 'reconnect' |
   'back')` and `&drop=ended` / `&drop=reconnect` in the URL (a drop shortly after connecting). The live backend has
   neither.

## Consequences

- The fastest the page can notice a wallet that ends the session is the library's 8 s grace; a wallet that vanishes
  without a word is noticed after the 75 s ping limit plus `reconnectGraceMs`. Measured with Cashonize
  (docs/MEASURED.md): 9.0 and 9.5 s for a removed session, 121.6 s for a closed wallet tab.
- Undo: `bash deploy/deploy.sh --rollback` returns the previous image; reverting the commit removes the watcher, and
  `reconnectGraceMs` can be raised in config without a code change.
