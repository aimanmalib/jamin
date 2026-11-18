# 0014: A third-party wallet over WizardConnect: Cashonize, no relay account

Date: 2026-11-18. Status: accepted.

## Context

Decision 0009 lets a seller trade from a wallet, but every test so far signs with the protocol test wallet in this
repository (`src/wallet/protocol-wallet.ts`). To show the escrow works with a wallet nobody here wrote, one branch
should be signed on mainnet by a third-party wallet that this project can run unattended.

Two transports exist for BCH dapp signing:

- **BCH WalletConnect** (`wc2-bch-bcr`): single address, `bch_signTransaction` and `bch_signMessage`. The dapp side
  needs a project id from the Reown relay service, issued to an account. This project has none.
- **WizardConnect** (`gitlab.com/riftenlabs/lib/wizardconnect`, LGPL-3.0-or-later per its `LICENSE.txt`; the npm
  packages carry no `license` field): the wallet shares chain-level xpubs (`receive`, `change`, `defi`) and signs
  transactions over end-to-end encrypted Nostr messages (NIP-17) through public relays (`relay.riften.net`,
  `relay.cauldron.quest` by default). No account, no project id. It has no message signing method. The SolidCash
  guide (`walletconnect.md`, section WizardConnect) describes the same transaction object plus `inputPaths`.

Wallets considered: Cashonize (web wallet, MIT, supports both transports as a wallet, builds to a static site with
pnpm and Quasar) and Paytaca (supports WizardConnect; a phone app, so it needs a person to approve).

## What was measured (spike, no funds)

Cashonize `v0.15.2` (commit `4542351748dc412763a4e50c04451735fc8cf038`) was cloned at that tag, installed with
`pnpm install --frozen-lockfile` (pnpm 11.10.0, from its `packageManager` field) and built with `pnpm build`. The
static build was served on `127.0.0.1` and driven by Playwright (Chromium, headless). A Node dapp on
`@wizardconnect/dapp` 0.2.8 and `@wizardconnect/core` 0.2.10 paired with it through the public relays.

- Pairing: Cashonize created a fresh HD wallet in the browser, accepted the `wiz://` URI and its xpub consent
  dialog; the dapp received `wallet_ready` with the paths `receive`, `change`, `defi` within seconds.
- One sign request (`broadcast: false`, two fake outpoints): input 0 a P2PKH coin at the wallet's `receive/0` key;
  input 1 a P2SH32 contract input whose unlocking bytecode carries the 65-byte signature placeholder, with
  `contract.redeemScript` set to the bytecode the signature must cover and `inputPaths` naming `defi/0`.
  Cashonize showed its "Sign transaction" dialog with the dapp's prompt and balance change; after Sign, the dapp
  checked both returned signatures: the P2PKH signature verifies under `receive/0`, the contract signature verifies
  under `defi/0` over the covered bytecode the dapp chose. Both are Schnorr with hash type `0x61`
  (`SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID`).
- The same request signed twice gave byte-identical transactions: Cashonize signs deterministically.

## Decision

- **Transport: WizardConnect**, on its default public relays. No relay account is needed, so no owner action is
  needed either (the owner-side step for a WalletConnect project id is not required).
- **Wallet: Cashonize**, built from tag `v0.15.2` at the commit above, run in Playwright on the host with a new
  wallet phrase of its own (`JAMIN_W3_MNEMONIC`, never printed) and funded from the project wallet through the
  spending budget check. A pinned tag and lockfile make the build repeatable.
- **How the escrow is signed (branch W2).** The wallet pays the seller's inputs (create and deposit) with the
  `receive` path in `inputPaths`, as decision 0009 does with `bch_signTransaction`. WizardConnect has no message
  signing, so the role key of 0009 is derived from the wallet's signature over one fixed sign request that spends
  a fake outpoint and is never broadcast; the measured determinism makes that key the same on every run. The
  request names the site, the role and the trade in its prompt, so the wallet shows what it signs.
- Not chosen for now: making the seller key the wallet's `defi` key and letting the wallet fill the contract
  placeholder. The spike shows the wallet can sign it, but the SolidCash SDK refuses a call whose contract
  signature is a placeholder (`docs/SOLIDCASH-FINDINGS.md`, F10), and Cashonize signs over `contract.redeemScript`
  while a SolidCash contract signature covers the bytecode of the called function, so the dapp would have to
  build the call outside the SDK.

## Consequences

- The web app and scripts add `@wizardconnect/dapp` and `@wizardconnect/core` at exact versions when branch W2 is
  built; NOTICE names them and their LGPL-3.0 licence (used unmodified).
- Cashonize is driven by a script, not a person: the proof shows a third-party wallet's own signing code, not a
  user's judgement. The README says so.
- If Cashonize stops signing deterministically, the derived role key changes; the run checks the role key's
  public key against the escrow before it signs anything.
- No pairing URI, QR code, wallet phrase or key appears in any capture or log.

## Implementation (branch X), 2026-11-18

- `src/wallet/wizard.ts` is the adapter: it names the inputs at the wallet's `receive/0` key in `inputPaths`, sends
  source outputs without a `contract` field (Cashonize then leaves the contract inputs empty, as the SDK sent them),
  and checks every returned signature against the shared key before the SDK uses the transaction. The role key is
  `sha256("jamin role key" || signature)` over a request that spends the made-up outpoint `sha256(message)` and pays
  a zero-value data output; the wallet shows the role key message as the prompt.
- `src/wallet/wizard-trade.ts` runs the seller's side (create, deposit, release) and is shared by the site's new
  "Wallet" tab (`web/ui/WalletTab.tsx`, mainnet, amount fixed in `config/jamin.json` `walletTrade`) and the tests.
  The tab needs a coin at output 0 in the wallet for the escrow's token genesis; it says so when there is none.
  Disputes on that tab go to the project's demo panel; the panel keys are public keys in the config.
- The content security policy allows the two default WizardConnect relays.
- `scripts/third-party-wallet.ts` drives branch X on mainnet: Cashonize in Playwright with its own phrase, the
  site's Wallet tab in a second browser page, the project wallet funding the third-party wallet once
  (`mainnet.thirdPartyWallet.fundSats`, at most `maxFundSats`) through the spending gate, and the buyer marking the
  trade paid from Node. Each step is recorded with `"signer": "wallet"` and `"wallet": "Cashonize v0.15.2"`.
- Tests: `test/JaminEscrow.wizard.test.ts` (a stand-in wallet that reads the wire form as Cashonize does) and
  `tests/third-party.test.ts` (funding, attaching from the page's keys, the record).
