# 0008: Disputes decided by a 2-of-3 arbitration panel

Date: 2026-11-18. Status: accepted.

## Context

OpenPeerEscrow trusts one arbitrator to decide every dispute (0001, `docs/THREAT_MODEL.md`). One key is one point of
failure: if it is lost, an open dispute can never be settled, and if it is stolen or bribed, the thief decides. Bitcoin
Cash has `OP_CHECKMULTISIG`, and SolidCash exposes it as `checkMultiSig(sig[] sigs, pubkey[] pks)`. Its documentation
(`website/docs/language/cryptography.md`) notes that the opcode checks legacy ECDSA signatures, so the SDK's default
Schnorr signature template does not fit, and that signatures must follow the order of the keys.

## Decision

- Both contracts take three arbitrator keys, `arbiterA`, `arbiterB`, `arbiterC`, in place of the single
  `arbitrator`. `resolveDispute(first, second, ...)` passes only when `checkMultiSig([first, second],
  [arbiterA, arbiterB, arbiterC])` is true (modifier `onlyPanel` in `contracts/EscrowBase.scash`). Any two members
  decide; the two signatures follow panel key order. Every other rule of a resolution is unchanged.
- One code path serves both set-ups. A single arbitrator fills all three slots with the same key and passes one
  ECDSA signature twice: the first signature matches slot A, the second slot B. No second contract is needed; the
  measured script sizes stay far below the 10,000 byte limit (`docs/MEASURED.md`, `## Script sizes`).
- The constructor refuses a panel slot holding the seller's or the buyer's key (`PartyOnPanel`), so a trading party
  can never be one of the two signers. Panel keys may repeat; repeating one is how a single arbitrator is set up, and
  a deployer who repeats a key in a 2-of-3 panel gives that member two votes on purpose.
- In the lifecycle scripts the panel members are HD paths of the same test wallet (`wallet.roles` `arbitrator`,
  `arbiterB`, `arbiterC` in `config/jamin.json`). Member A pays the network fee of a resolution; B and C only sign
  and hold no coins.
- The error name stays `NotArbitrator`; it now means "not signed by two panel members".

## Consequences

- A lost or compromised single panel key can neither block nor decide a dispute.
- Wallets must produce ECDSA signatures for a resolution (`SignatureAlgorithm.ECDSA` in the SDK). A test checks that
  Schnorr signatures are refused.
- Contract parameters grow by two keys (66 bytes) and a resolution's unlocking data by one signature. Artifacts and
  every earlier txid were made with the single arbitrator contract; regtest and mainnet runs after this change use the
  panel contract.

## Rollback

Revert the commit that adds `onlyPanel`; the single-key `onlyArbitrator` modifier and the four-key parameter list
return, and the lifecycle scripts read the old roles. Deployed escrows are not affected either way: each keeps the
script it was created with.
