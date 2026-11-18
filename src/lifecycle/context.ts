// What a lifecycle run needs from a network: a provider, the parties as signers (with the three arbitration panel
// keys), the escrow terms, and the
// network's way of letting time pass. The branches in branches.ts read only this, so the same code runs on regtest
// and mainnet.
import { readFileSync } from 'node:fs';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { SignatureAlgorithm, SignatureTemplate, Signer, type Artifact, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import type { StatefulContract } from '@solidcash/solidcash/stateful';
import { repoRoot } from '../config.js';

/** `arbitrator` is panel member A and pays for a resolution; `arbiterB` and `arbiterC` only sign. */
export type PartyName = 'seller' | 'buyer' | 'arbitrator' | 'arbiterB' | 'arbiterC' | 'fees';

/** The arbitration panel in contract key order. */
export const PANEL = ['arbitrator', 'arbiterB', 'arbiterC'] as const satisfies readonly PartyName[];

export interface Party {
  signer: Signer;
  sig: SignatureTemplate;
  /** Legacy ECDSA signature, which OP_CHECKMULTISIG (the panel check) needs. */
  ecdsa: SignatureTemplate;
  publicKey: Uint8Array;
  address: string;
}

export interface Terms {
  /** Trade amount: satoshis for the BCH escrow, token units for the token escrow. */
  amount: bigint;
  tokenAmount: bigint;
  feeBps: bigint;
  disputeFee: bigint;
  waitSeconds: bigint;
  /** Satoshis that open the escrow's satoshi container and stay in it. */
  reserve: bigint;
}

export interface Step {
  branch: string;
  step: string;
  txid: string;
  /** The escrow's address, on the step that created it. */
  escrow?: string;
  /** Set when a wallet signed the transaction's seller inputs over `bch_signTransaction` (branch W, 0009). */
  signer?: 'wallet';
}

export interface Ctx {
  network: string;
  provider: NetworkProvider;
  parties: Record<PartyName, Party>;
  terms: Terms;
  /** A plain coin of `party` at output 0, which a deployment needs for its CashToken genesis. */
  genesisCoin(party: PartyName): Promise<Utxo>;
  /** A token coin of the seller holding at least `amount` units, for the token branch. */
  tokenCoin(amount: bigint): Promise<{ category: string; coin: Utxo }>;
  /** Resolves once the chain's median time past is at or after `timestamp`. */
  waitUntil(timestamp: bigint): Promise<void>;
  record(step: Step): void;
}

export function party(privateKey: Uint8Array, provider: NetworkProvider): Party {
  const signer = new Signer(privateKey, provider);
  return { signer, sig: new SignatureTemplate(privateKey),
    ecdsa: new SignatureTemplate(privateKey, undefined, SignatureAlgorithm.ECDSA),
    publicKey: signer.publicKey, address: signer.address };
}

export function loadArtifact(name: string): Artifact {
  return JSON.parse(readFileSync(`${repoRoot}artifacts/solidcash/${name}.json`, 'utf8')) as Artifact;
}

export function lockOf(address: string): Uint8Array {
  const lock = cashAddressToLockingBytecode(address);
  if (typeof lock === 'string') throw new Error(lock);
  return lock.bytecode;
}

type CallBuilder = ReturnType<NonNullable<StatefulContract['call'][string]>>;

/** The call builder of entry point `name` on `contract` connected as `p`. */
export function call(contract: StatefulContract, p: Party, name: string, ...args: unknown[]): CallBuilder {
  const connected = contract.connect(p.signer);
  const fn = connected.call[name];
  if (fn === undefined) throw new Error(`contract has no entry point ${name}`);
  return fn(p.sig, ...(args as []));
}

/** `resolveDispute` signed by two panel members in panel key order; the arbitrator (member A) pays the fee. */
export function panelCall(contract: StatefulContract, parties: Record<PartyName, Party>,
  signers: readonly [PartyName, PartyName], ...args: unknown[]): CallBuilder {
  const fn = contract.connect(parties.arbitrator.signer).call.resolveDispute;
  if (fn === undefined) throw new Error('contract has no entry point resolveDispute');
  return fn(...([...signers.map((n) => parties[n].ecdsa), ...args] as []));
}

export async function satsAt(provider: NetworkProvider, address: string): Promise<bigint> {
  return (await provider.getUtxos(address)).filter((u) => !u.token).reduce((a, u) => a + u.satoshis, 0n);
}

export async function tokensAt(provider: NetworkProvider, address: string, category: string): Promise<bigint> {
  return (await provider.getUtxos(address)).filter((u) => u.token?.category === category)
    .reduce((a, u) => a + (u.token?.amount ?? 0n), 0n);
}

export function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`check failed: ${what}`);
}
