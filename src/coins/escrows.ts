// The escrow contracts of examples/mainnet.json, attached again from the wallet's keys so their addresses and entry
// points can be read. Branch W's seller key came from a wallet signature over a trade named after the chain's median
// time past at the time of the run (src/lifecycle/wallet-branch.ts); the blocks before its deployment give the
// candidates, and the one whose contract sits at the recorded address is it.
import { hexToBin } from '@bitauth/libauth';
import { SignatureTemplate, type NetworkProvider } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { PANEL, loadArtifact, type Party, type PartyName } from '../lifecycle/context.js';
import { ProtocolWallet } from '../wallet/protocol-wallet.js';
import { roleKeyFrom, roleKeyMessage } from '../wallet/role-key.js';
import { lockHex } from './paths.js';
import type { ContractAddress } from './classify.js';

export interface Attached {
  sc: StatefulContract;
  /** The parties as the contract checks them; branch W's seller signs with its role key. */
  parties: Record<PartyName, Party>;
  category?: string;
}

function params(parties: Record<PartyName, Party>, extra: unknown[]): unknown[] {
  return [parties.seller.publicKey, parties.buyer.publicKey, ...PANEL.map((n) => parties[n].publicKey),
    parties.fees.signer.pkh, ...extra];
}

export async function attach(address: string, parties: Record<PartyName, Party>, provider: NetworkProvider,
  category?: string): Promise<Attached> {
  const artifact = loadArtifact(category === undefined ? 'JaminEscrow' : 'JaminTokenEscrow');
  const sc = await StatefulContract.at(address, artifact, provider,
    { constructorArgs: params(parties, category === undefined ? [] : [category]) as never }) as unknown as StatefulContract;
  return { sc, parties, ...(category === undefined ? {} : { category }) };
}

/** Whether the attached contract is the one at `address` (its token-aware form has the same lock). */
export function sitsAt(sc: StatefulContract, address: string): boolean {
  return lockHex(sc.tokenAddress) === lockHex(address);
}

/** A block header's timestamp (bytes 68 to 71, little endian). */
export function headerTime(headerHex: string): number {
  const b = hexToBin(headerHex);
  return ((b[68] ?? 0) | (b[69] ?? 0) << 8 | (b[70] ?? 0) << 16) + (b[71] ?? 0) * 2 ** 24;
}

/** Median of the last eleven block times ending at each tip in `tips`. `times` maps height to timestamp. */
export function medianTimePast(times: ReadonlyMap<number, number>, tip: number): number {
  const window: number[] = [];
  for (let h = tip - 10; h <= tip; h++) {
    const t = times.get(h);
    if (t === undefined) throw new Error(`no block time for ${h}`);
    window.push(t);
  }
  return window.sort((a, b) => a - b)[5] ?? 0;
}

export interface WalletSellerSearch {
  template: string;
  site: string;
  network: string;
  /** Height of the block the escrow was created in. */
  createdAt: number;
  /** How many tips before it to try. */
  depth: number;
  blockTime(height: number): Promise<number>;
}

/** Branch W attached with its seller's role key, or undefined when no candidate trade name matches. */
export async function attachWalletBranch(address: string, parties: Record<PartyName, Party>, provider: NetworkProvider,
  s: WalletSellerSearch): Promise<Attached | undefined> {
  const wallet = new ProtocolWallet(parties.seller.signer.privateKey);
  const times = new Map<number, number>();
  for (let h = s.createdAt - s.depth - 10; h < s.createdAt; h++) times.set(h, await s.blockTime(h));
  for (let tip = s.createdAt - 1; tip >= s.createdAt - s.depth; tip--) {
    const trade = `${s.network}-W-${medianTimePast(times, tip)}`;
    const message = roleKeyMessage(s.template, { site: s.site, role: 'seller', trade });
    const role = new SignatureTemplate(roleKeyFrom(message, await wallet.signMessage(message), wallet.pkh));
    const seller: Party = { ...parties.seller, sig: role, ecdsa: role, publicKey: role.publicKey };
    const attached = await attach(address, { ...parties, seller }, provider);
    if (sitsAt(attached.sc, address)) return attached;
  }
  return undefined;
}

/** Every address a finished escrow may hold coins at, by lock. */
export function addressesOf(a: Attached): ContractAddress[] {
  const { sc } = a;
  const at = (address: string, kind: ContractAddress['kind'], event?: string): ContractAddress =>
    ({ lock: lockHex(address), address, kind, ...(event === undefined ? {} : { event }) });
  const out = [at(sc.tokenAddress, 'master'), at(sc.getDataNftAddress(), 'data'),
    at(sc.getSatoshiContainerAddress(), 'satoshiContainer')];
  if (a.category !== undefined) out.push(at(sc.getTokenContainerAddress(a.category), 'tokenContainer'));
  for (const e of sc.inner.artifact.events ?? []) out.push(at(sc.getEventNftAddress(e.name), 'event', e.name));
  return out;
}
