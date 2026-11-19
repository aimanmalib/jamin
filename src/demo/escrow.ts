// The public demo escrow on a network: attach to it, read its status, and release it signed with the demo seller key.
// The same code runs in the browser (the "Release on mainnet" card) and in Node (scripts/demo-escrow.ts on regtest
// and mock). A dry release builds and signs the transaction and stops at the provider: nothing is broadcast.
import { decodeAuthenticationInstructions, decodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { SignatureTemplate, Signer, type Artifact, type NetworkProvider } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import type { DemoKey, DemoRole } from './config.js';

/** EscrowBase.Status names, in declaration order. */
export const DEMO_STATUS = ['created', 'funded', 'paid', 'disputed', 'released', 'cancelledByBuyer',
  'cancelledBySeller', 'resolved'] as const;
export type DemoStatus = (typeof DEMO_STATUS)[number];

export interface DemoParties { keys: Record<DemoRole, DemoKey>; feeRecipientPkh: Uint8Array }

/** Contract parameters in JaminEscrow's order: seller, buyer, panel A, B, C, fee recipient. */
export function demoParams(p: DemoParties): Uint8Array[] {
  const k = p.keys;
  return [k.seller.publicKey, k.buyer.publicKey, k.panelA.publicKey, k.panelB.publicKey, k.panelC.publicKey,
    p.feeRecipientPkh];
}

export async function attachDemo(provider: NetworkProvider, artifact: Artifact, p: DemoParties,
  address: string): Promise<StatefulContract> {
  const sc = await StatefulContract.at(address, artifact, provider, { constructorArgs: demoParams(p) as never });
  return sc as unknown as StatefulContract;
}

export async function demoStatus(sc: StatefulContract): Promise<DemoStatus> {
  const s = await sc.getState() as { status: bigint | number };
  return DEMO_STATUS[Number(s.status)] ?? 'created';
}

export interface Released {
  txid: string;
  bytes: number;
  /** False for a dry release: the transaction was signed and never left this process. */
  sent: boolean;
}

/** Thrown in place of a broadcast during a dry release. */
export class DryRun extends Error {
  constructor(readonly hex: string) {
    super('dry run: the transaction was not broadcast');
    this.name = 'DryRun';
  }
}

/** Whether every input of `hex` is a plain P2PKH spend (a signature and a public key), as in a fee coin split. */
export function plainOnly(hex: string): boolean {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') return false;
  return tx.inputs.every((input) => {
    const parts = decodeAuthenticationInstructions(input.unlockingBytecode);
    return parts.length === 2 && parts.every((x) => 'data' in x);
  });
}

const SENDS = new Set(['sendRawTransaction', 'sendPreparedTransaction']);

/** `provider` with every broadcast refused: the first transaction offered is kept in `taken` and thrown as DryRun. */
export function dryProvider(provider: NetworkProvider): { provider: NetworkProvider; taken: string[] } {
  const taken: string[] = [];
  const wrapped = new Proxy(provider, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (typeof prop === 'string' && SENDS.has(prop)) {
        return (arg: unknown): Promise<never> => {
          const hex = typeof arg === 'string' ? arg : (arg as { rawHex: string }).rawHex;
          taken.push(hex);
          return Promise.reject(new DryRun(hex));
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
  return { provider: wrapped, taken };
}

/**
 * Signs `release` as the demo seller and broadcasts it, or with `dry` only builds it. The seller's fee coins pay the
 * network fee. A dry release that meets a plain coin split first reports it: the staged fee coins are too few.
 */
export async function releaseDemo(provider: NetworkProvider, artifact: Artifact, p: DemoParties, address: string,
  dry: boolean): Promise<Released> {
  const net = dry ? dryProvider(provider) : { provider, taken: [] as string[] };
  const sc = await attachDemo(net.provider, artifact, p, address);
  const seller = new Signer(p.keys.seller.privateKey, net.provider);
  const fn = sc.connect(seller).call.release;
  if (fn === undefined) throw new Error('contract has no entry point release');
  try {
    const { txid, hex } = await fn(new SignatureTemplate(p.keys.seller.privateKey) as never).send();
    return { txid, bytes: hex.length / 2, sent: true };
  } catch (e) {
    const hex = net.taken[0];
    if (!dry || hex === undefined || !(e instanceof DryRun)) throw e;
    if (plainOnly(hex)) throw new Error('the release needs more fee coins at the demo seller than are staged');
    return { txid: hashTransaction(hexToBin(hex)), bytes: hex.length / 2, sent: false };
  }
}
