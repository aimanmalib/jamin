// Shared setup for the escrow contract tests: a production-profile mock network (BCH size limits, dust rule),
// four funded roles and deploy helpers that read the artifacts SolidHat compiles before the tests run.
import { readFileSync } from 'node:fs';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { SignatureTemplate, type Artifact, type Utxo } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { asProvider, entry } from '../../src/sdk/mock.js';

export { entry };

export const ARTIFACT_DIR = 'artifacts/solidcash';

export function loadArtifact(name: string): Artifact {
  return JSON.parse(readFileSync(`${ARTIFACT_DIR}/${name}.json`, 'utf8')) as Artifact;
}

/** Satoshis that open the single satoshi container at deployment and stay in it. */
export const RESERVE_SATS = 1_000n;

export const TERMS = { amount: 200_000n, feeBps: 30n, disputeFee: 5_000n, waitSeconds: 3_600n };

type Signer = Awaited<ReturnType<MockNetworkProvider['getSigners']>>[number];

export interface Roles {
  seller: Signer;
  buyer: Signer;
  arbitrator: Signer;
  fees: Signer;
  outsider: Signer;
}

export interface World {
  provider: MockNetworkProvider;
  roles: Roles;
  sig: (signer: Signer) => SignatureTemplate;
  cancelAfter: bigint;
}

export async function world(): Promise<World> {
  const provider = new MockNetworkProvider({ profile: 'production' });
  const [seller, buyer, arbitrator, fees, outsider] = await provider.getSigners(5);
  if (!seller || !buyer || !arbitrator || !fees || !outsider) throw new Error('mock signers missing');
  const cancelAfter = BigInt(provider.getBlockTime()) + TERMS.waitSeconds;
  return { provider, roles: { seller, buyer, arbitrator, fees, outsider },
    sig: (s) => new SignatureTemplate(s.privateKey), cancelAfter };
}

export function roleParams(r: Roles): unknown[] {
  return [r.seller.publicKey, r.buyer.publicKey, r.arbitrator.publicKey, r.fees.pkh];
}

export async function fundingCoin(provider: MockNetworkProvider, signer: Signer): Promise<Utxo> {
  const coin = (await provider.getUtxos(signer.address)).find((u) => u.vout === 0 && !u.token);
  if (!coin) throw new Error('no plain vout 0 coin for a deployment');
  return coin;
}

/** Sum of plain BCH at an address (token-carrying coins excluded). */
export async function satsAt(provider: MockNetworkProvider, address: string): Promise<bigint> {
  return (await provider.getUtxos(address)).filter((u) => !u.token).reduce((a, u) => a + u.satoshis, 0n);
}

export async function tokensAt(provider: MockNetworkProvider, address: string, category: string): Promise<bigint> {
  return (await provider.getUtxos(address)).filter((u) => u.token?.category === category)
    .reduce((a, u) => a + (u.token?.amount ?? 0n), 0n);
}

export interface Deployed {
  sc: StatefulContract;
  categoryId: string;
  txid: string;
}

export async function deploy(w: World, name: string, params: unknown[], initArgs: unknown[]): Promise<Deployed> {
  const { seller } = w.roles;
  const { contract, tx, categoryId } = await StatefulContract.deploy(loadArtifact(name), params as never, {
    provider: asProvider(w.provider), fundingUtxo: await fundingCoin(w.provider, seller), funder: seller.unlockP2PKH(),
    changeAddress: seller.address, initArgs: initArgs as never, initialBalance: RESERVE_SATS,
  });
  return { sc: contract.connect(seller), categoryId, txid: tx.txid };
}

export async function statusOf(sc: StatefulContract): Promise<bigint> {
  const state = await sc.getState() as Record<string, unknown>;
  return BigInt(state.status as bigint | number);
}

/** EscrowBase.Status, in declaration order. */
export const Status = {
  Created: 0n, Funded: 1n, Paid: 2n, Disputed: 3n, Released: 4n, CancelledByBuyer: 5n, CancelledBySeller: 6n,
  Resolved: 7n,
} as const;

export function lockOf(address: string): Uint8Array {
  const lock = cashAddressToLockingBytecode(address);
  if (typeof lock === 'string') throw new Error(lock);
  return lock.bytecode;
}

/**
 * A time-type locktime the mock accepts now (one second behind its median time past). Calls that check `tx.time`
 * and pay out also name their payment by hand: SolidCash 0.51.1 does not derive it once a locktime is set
 * (docs/SOLIDCASH-FINDINGS.md, F6).
 */
export async function lockTimeNow(w: World): Promise<number> {
  return await w.provider.getMedianTimePast() - 1;
}
