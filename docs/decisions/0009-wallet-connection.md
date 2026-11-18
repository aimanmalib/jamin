# 0009: Trading from a wallet: the wallet pays, a wallet-derived role key authorises

Date: 2026-11-18. Status: accepted.

## Context

Until now every party of a lifecycle run is a key the script holds. A real seller keeps their coins in a wallet
(Paytaca, Cashonize, Zapit) that never hands out its key and signs through the BCH WalletConnect protocol
(`wc2-bch-bcr`): `bch_getAddresses`, `bch_signTransaction` and `bch_signMessage`. The SolidCash SDK supports such a
wallet as `Signer.external({ wallet, address, publicKey })`: it builds a transaction with a placeholder in the
wallet's P2PKH inputs, hands the wallet the transaction over `bch_signTransaction`, and broadcasts what the wallet
returns.

The escrow, however, authorises each party with `checkSig(s, seller)` inside the contract (0002), and the SDK needs
that signature while it builds a call: the mandatory BCH-2026 preflight evaluates the contract input, and
`SignatureTemplate.generateSignature` is called synchronously, eleven times for one `fund` call on the mock network,
as the fee converges. A wallet that is asked asynchronously, once, for a finished transaction cannot supply it. A
placeholder signature, which the wc2 protocol defines for exactly this, is refused by the preflight
(`docs/SOLIDCASH-FINDINGS.md`, F10).

Options considered:

1. Authorise the seller by `tx.origin` (the first plain P2PKH input) instead of `checkSig`, so the wallet's input
   signature is the authorisation. Rejected: the SolidCash documentation advises `checkSig` / `checkMultiSig` for
   authorisation and the compiler warns on `tx.origin`; any signature the wallet ever made over a coin at that
   address with `SIGHASH_ANYONECANPAY` could be reused to call the escrow; and the contract, its tests, sizes and
   regtest proof would all change.
2. Keep the role key in the page as a random key. Rejected: it is lost with the browser's storage, and with it the
   seller's only way to release or cancel.
3. Derive the role key from a message the wallet signs. Chosen.

## Decision

- **The wallet pays.** Creating the escrow, the seller's deposit and the network fee of each seller call are paid
  from the wallet's coins through `Signer.external`; the wallet signs those inputs itself over
  `bch_signTransaction`. The contract is unchanged.
- **A role key authorises.** The seller's escrow key is `sha256("jamin role key" || signature)`, where `signature`
  is the wallet's `bch_signMessage` signature over the message in `config/jamin.json`
  (`walletSigning.roleKeyMessage`, naming the site, the role and a trade name). Before deriving, the page checks
  that the signature recovers to the connected wallet's key (`src/wallet/role-key.ts`). Wallets sign messages
  deterministically (RFC 6979), so the same wallet and trade name give the same key on any device.
- **The protocol test wallet.** `src/wallet/protocol-wallet.ts` is the wallet side of `bch_signTransaction` and
  `bch_signMessage` for one key: it signs only empty inputs at its own P2PKH lock and refuses a request with none.
  The tests and the lifecycle scripts use it where a phone wallet would sit, so the wallet path is tested without a
  WalletConnect session. It imports only libauth and runs in the browser as well.
- The tests are `test/JaminEscrow.wallet.test.ts` (create, deposit and release with every seller input signed by
  the wallet; a release signed with the wallet key instead of the role key is refused; the placeholder refusal of
  F10) and `tests/protocol-wallet.test.ts`.

## Consequences

- Payments to the seller (a buyer cancel, a seller cancel, a dispute the seller wins) go to the role key's P2PKH
  address, not to the wallet's address, because the contract pays `hash160(seller)`. The page can sweep them to the
  wallet with the role key. This is a stated limit, not hidden.
- Anyone who gets the wallet to sign the exact role key message gets the role key. The message names the site and
  the trade, and a wallet shows the message before signing (`docs/THREAT_MODEL.md`, attack 30).
- A live WalletConnect session needs a relay project id issued to the site's operator. Until one is configured the
  web app connects the in-page protocol test wallet on the mock network only, and the README says so.
- If SolidCash later accepts an asynchronous external signature for a contract argument (F10), the role key can be
  dropped and the wallet key used in the contract directly; the contract would not change.
