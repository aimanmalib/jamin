# 0019: A relayer that holds no key

Date: 2026-11-19. Status: accepted.

## Context

A party can sign an escrow call without being able to broadcast it: a wallet that signs offline, or a phone with
no connection to a server it trusts. Someone else then has to send the signed transaction. That someone should not
be trusted with anything: not a key, not the choice of outputs, not the fee.

## Decision

`src/relay/relay.ts` is a relayer with no key and no signer. The signing party hands over two things: the signed
transaction hex and an intent (JSON) naming the escrow coin it spends and every output it pays, in order, with
satoshis and any token category, amount and NFT. The relayer:

1. refuses a transaction that does not spend each coin the intent names, has another number of outputs, or has any
   output that differs from the intent (address, satoshis, token category, token amount, NFT), and sends nothing;
2. otherwise sends the bytes it was given, unchanged;
3. refuses a send whose reported txid is not the hash of those bytes.

It cannot pay for anything: the fee is inside the signed transaction. `scripts/relay.ts` runs the check from files
and, with `--send`, broadcasts to the configured mainnet server through the spending gate (decision 0007), like
every other mainnet broadcast. The script derives the test wallet's public locking scripts so the ledger counts any
wallet coin a relayed transaction spends; it signs nothing. There is no relay server.

The relayer's check is a convenience for the party and the operator, not the protection. The protection is that the
party's signature (SIGHASH_ALL with the spent outputs) and the escrow covenant cover every output: a relayer that
changes an output and rewrites the intent to match is refused by the network. `test/relay.test.ts` shows both on a
real escrow on the mock network; `tests/relay.test.ts` covers each check and that the module imports no key,
signer, phrase or environment file.

## Consequences

- No contract change (decision 0018).
- A relayer can still decline to send, or send late. The party can hand the same transaction to another relayer or
  send it itself; the escrow's waiting times are unchanged.
- Branch T (`src/lifecycle/relayed.ts`, `scripts/lifecycle.ts --relay buyerCancel`) runs it end to end: the buyer
  writes the signed `buyerCancel` of a token escrow and its intent to two files, and `scripts/relay.ts`, started as
  its own process (`scripts/relay-process.ts`), checks and sends them. On regtest it sends to the node over JSON-RPC
  and mines one block; it has run there (`docs/MEASURED.md`, "Relayed token cancel on regtest").
- No relayed transaction has been broadcast on mainnet; the mainnet runs broadcast their own transactions.
