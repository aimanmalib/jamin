# Threat model

What each party can and cannot do with a Jamin escrow, and the test that shows it. Test names are quoted from the
SolidHat suite (`npm run solidhat:test`); "BCH" means `test/JaminEscrow*.test.ts`, "token" means
`test/JaminTokenEscrow*.test.ts`. `docs/MEASURED.md` ("Sabotage checks") records which of these tests fail when the
check they cover is removed from a copy of the contract. The rules themselves are in `docs/SPEC.md`.

## Parties and trust

| Party | Trusted for | Not trusted for |
|---|---|---|
| Seller | sending the coins in the first place | releasing honestly, or at all |
| Buyer | nothing | marking paid only after paying fiat |
| Arbitration panel (three keys, any two decide) | two of three members deciding a dispute fairly | anything outside an open dispute; any single member |
| Fee recipient | nothing (receives only) | |
| Anyone else (including whoever builds or relays the transaction) | nothing | |

The original OpenPeer escrow trusts one arbitrator. Jamin replaces it with a panel of three keys, any two of which must
sign (`checkMultiSig`, docs/decisions/0008); one arbitrator can still be used by putting its key in all three slots.
The contract limits the panel to choosing between two fixed payouts of an open dispute.

## Attacks and the tests that run them

| # | Who | Attempt | Result | Test |
|---|---|---|---|---|
| 1 | anyone but the seller | release the coins | `NotSeller` | BCH "rejects a release signed by anyone but the seller (NotSeller)" |
| 2 | seller | mark the trade paid on the buyer's behalf | `NotBuyer` | BCH "rejects mark as paid by the seller (NotBuyer)" |
| 3 | seller | cancel as if they were the buyer | `NotBuyer` | BCH state "refuses a buyer cancel signed by the seller (NotBuyer)" |
| 4 | buyer | deposit into the seller's escrow to change its state | `NotSeller` | BCH state "refuses a deposit signed by the buyer (NotSeller)" |
| 5 | buyer, seller or outsider | resolve a dispute without being the arbitrator | `NotArbitrator` | BCH and token "rejects a dispute resolution signed by the buyer / seller / outsider (NotArbitrator)" |
| 6 | seller or outsider | open a dispute in the other side's name | `NotBuyer` / `NotSeller` | BCH state "refuses a buyer-side dispute signed by the seller (NotBuyer)", "refuses a seller-side dispute signed by an outsider (NotSeller)" |
| 7 | arbitrator | move the coins when no dispute is open | `NoDispute` | BCH state "refuses a dispute resolution when no dispute is open (NoDispute)" |
| 8 | seller | take the coins back before the waiting time | `TooEarly` | BCH and token "rejects a seller cancel before the waiting time (TooEarly)" |
| 9 | seller | take the coins back after the buyer marked paid | `AlreadyMarkedPaid` | BCH and token "rejects a seller cancel after mark as paid, even after the waiting time (AlreadyMarkedPaid)" |
| 10 | buyer or seller | open a dispute before the buyer marked paid | `NotPaid` | BCH and token "rejects a dispute before the buyer marked it paid (NotPaid)" |
| 11 | buyer or seller | open a dispute paying less (or more) than the dispute fee | `WrongDisputeFee` | BCH and token "rejects a dispute with the wrong dispute fee (WrongDisputeFee)" |
| 12 | one side | pay the dispute fee twice to change the payout | `AlreadyPaidDispute` | BCH and token "rejects a second dispute fee from the same side (AlreadyPaidDispute)" |
| 13 | seller | release (or buyer cancel) after a dispute opens, to go around the arbitrator | `NotOpen` | BCH and token "rejects a release once disputed (NotOpen)", "rejects a buyer cancel once disputed (NotOpen)" |
| 14 | seller | fund the escrow with less than amount + fee, or fund it twice | `WrongDeposit` / `AlreadyFunded` | BCH "rejects a deposit that is not exactly amount + fee (WrongDeposit)", BCH state "refuses a second deposit (AlreadyFunded)", token covenant "rejects a token deposit short of amount + fee + reserve (WrongDeposit)" |
| 15 | buyer | mark paid before the seller funded, to look committed | `NotFunded` | BCH state "refuses mark as paid before the deposit (NotFunded)" |
| 16 | anyone building a release | pay the amount to another address | rejected by the covenant | BCH covenant "rejects a release that pays the amount to someone other than the buyer"; token covenant "rejects a token release that pays the tokens to someone other than the buyer" |
| 17 | anyone building a release | pay the buyer less, or one token unit less | rejected | BCH covenant "rejects a release that pays the buyer less than the amount"; token covenant "rejects a token release that pays the buyer one unit less" |
| 18 | anyone building a release | redirect the fee to the buyer | rejected | BCH covenant "rejects a release that sends the fee to the buyer instead of the fee recipient"; token covenant "rejects a token release that sends the token fee to the buyer" |
| 19 | anyone building a release | add an extra payment out of the escrow | rejected | BCH covenant "rejects a release with an extra payment out of the escrow" |
| 20 | anyone building a cancel | pay a buyer cancel to the buyer | rejected | BCH covenant "rejects a buyer cancel that pays the buyer instead of the seller"; token covenant "rejects a token buyer cancel that pays the buyer instead of the seller" |
| 21 | anyone building a seller cancel | keep the fee aside in a second output | rejected | BCH covenant "rejects a seller cancel that keeps the fee in a second output to the fee recipient" |
| 22 | arbitrator or relayer | pay a buyer-won dispute to the seller | rejected | BCH covenant "rejects a dispute resolution for the buyer that pays the seller" |
| 23 | any party | spend a closed escrow again | rejected (final status) | BCH state "cannot be spent again once released", "... once cancelled by the buyer", "... once the dispute is resolved" |
| 24 | any party | call the token escrow with another token category | `WrongToken` | token "rejects a call naming another token category (WrongToken)" |
| 25 | seller | create an escrow with a zero amount, no dispute fee, or a block-height waiting time | `InvalidAmount` / `InvalidDisputeFee` / `InvalidCancelTime` | BCH state "refuses to create an escrow with a zero amount (InvalidAmount)", "... without a dispute fee (InvalidDisputeFee)", "refuses a waiting time given as a block height (InvalidCancelTime)" |
| 26 | one panel member, alone or with an outsider or a trading party | resolve a dispute with one valid panel signature | rejected | panel "refuses one panel signature with an outsider signature" (BCH and token), "refuses a trading party as the second signer" |
| 27 | one panel member | count its own signature twice | rejected | panel "refuses the same panel signature given twice", "refuses a panel member of a single-arbitrator escrow who is not that arbitrator" |
| 28 | seller or buyer | sit on the panel of its own escrow | `PartyOnPanel` | panel "refuses to create an escrow with the seller / buyer in panel slot A / B / C (PartyOnPanel)" |
| 29 | anyone building a resolution | give the two panel signatures out of key order, or as Schnorr signatures | rejected | panel "refuses two panel signatures out of panel key order", "refuses Schnorr signatures, which OP_CHECKMULTISIG does not accept here" |

The payout rules of a dispute (winner's fee returned, loser's fee to the fee recipient) are checked by BCH "resolves
a two-sided dispute for the buyer" and "... for the seller", BCH "pays the seller back in full when the buyer alone
disputed and lost", token "resolves a dispute for the buyer with BCH dispute fees" and token "resolves a two-sided
dispute for the seller: tokens and fee back, BCH dispute fees settled".

## Risks the contract does not remove

These are properties of the design, not covered by a test that makes them fail:

- **The panel decides.** Two dishonest or compromised panel members can give an open dispute to the wrong side; one
  cannot (attacks 26 to 28). An escrow set up with a single arbitrator in all three slots trusts that one key. The
  panel cannot act before a dispute opens (attack 7) or pay anyone but the buyer, the seller and the fee recipient.
- **A false "paid".** A buyer can mark paid without paying. The seller then cannot cancel (attack 9) and has to open
  a dispute and pay the dispute fee to get the coins back through the arbitrator. This is the same in the original
  OpenPeer escrow.
- **No answer from the seller.** If the seller never releases after a real payment, the buyer opens a dispute.
  There is no automatic release to the buyer after a time.
- **Checking the contract before paying fiat.** The contract enforces the terms it was deployed with. The buyer must
  check the parameters (seller, buyer key, the three panel keys, fee recipient), the terms and the `Funded` status of the
  escrow address before sending fiat; the contract cannot know which address the two agreed on.
- **Time.** `sellerCancel` uses `tx.time`, which Bitcoin Cash checks against the median time of past blocks. It can
  lag real time by about an hour, so a seller cancel becomes possible roughly an hour after `cancelAfter` by the
  clock. Miners can move block times only within the consensus rules.
- **Keys.** Anyone with a party's private key acts as that party. Jamin stores no keys: the web app's simulator
  uses the mock network's built-in test signers and contacts no network, and the lifecycle scripts read the test wallet from a local `.env` that is
  not part of the repository or the site image.
- **Compiler and SDK.** The covenant checks are compiled by SolidCash 0.51.1. Issues found while building on it are
  in `docs/SOLIDCASH-FINDINGS.md`; none of them lets a payout go to a different party in the tests above.
