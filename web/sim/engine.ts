// The in-browser simulator: the real compiled escrow artifacts running on the SolidCash mock network with the
// production profile (BCH size limits, dust rule). No keys leave the page and no network is contacted.
import { SignatureTemplate, type Artifact, type Utxo } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { rejectionName } from './errors.js';

export type Asset = 'bch' | 'token';
export type Actor = 'seller' | 'buyer' | 'arbitrator' | 'outsider';
export type Action = 'markAsPaid' | 'release' | 'buyerCancel' | 'sellerCancel' | 'openDispute' | 'resolveForBuyer'
  | 'resolveForSeller';

export const ACTIONS: readonly Action[] = ['markAsPaid', 'release', 'buyerCancel', 'sellerCancel', 'openDispute',
  'resolveForBuyer', 'resolveForSeller'];

/** EscrowBase.Status names, in declaration order. */
export const STATUS = ['created', 'funded', 'paid', 'disputed', 'released', 'cancelledByBuyer', 'cancelledBySeller',
  'resolved'] as const;
export type StatusName = (typeof STATUS)[number];

export interface SimTerms {
  /** Satoshis (BCH escrow) or token units (token escrow). */
  amount: bigint;
  feeBps: bigint;
  disputeFee: bigint;
  waitSeconds: bigint;
  reserve: bigint;
}

export interface LogEntry {
  actor: Actor;
  action: Action | 'createEscrow' | 'fund' | 'deposit' | 'wait';
  ok: boolean;
  txid?: string;
  bytes?: number;
  error?: string;
  /** The first line of the rejection message, for the curious. */
  detail?: string;
}

type Signer = Awaited<ReturnType<MockNetworkProvider['getSigners']>>[number];
type Escrow = StatefulContract;

export interface Artifacts { bch: Artifact; token: Artifact }

function lockOf(address: string): Uint8Array {
  const lock = cashAddressToLockingBytecode(address);
  if (typeof lock === 'string') throw new Error(lock);
  return lock.bytecode;
}

export class Simulation {
  readonly log: LogEntry[] = [];
  private constructor(readonly asset: Asset, readonly terms: SimTerms, private readonly provider: MockNetworkProvider,
    private readonly people: Record<Actor, Signer>, private readonly sc: Escrow, readonly category: string | undefined,
    readonly fee: bigint) {}

  /** Deploys an escrow of `asset` and funds it as the seller. */
  static async start(artifacts: Artifacts, asset: Asset, terms: SimTerms): Promise<Simulation> {
    const provider = new MockNetworkProvider({ profile: 'production' });
    const [seller, buyer, arbitrator, fees, outsider] = await provider.getSigners(5);
    if (!seller || !buyer || !arbitrator || !fees || !outsider) throw new Error('mock signers missing');
    const people = { seller, buyer, arbitrator, outsider };
    const cancelAfter = BigInt(provider.getBlockTime()) + terms.waitSeconds;
    let category: string | undefined;
    let tokenCoin: Utxo | undefined;
    const fee = tradeFee(terms.amount, terms.feeBps, asset === 'bch' ? 546n : 1n);
    if (asset === 'token') {
      const minted = await provider.addTokenUtxos([{ address: seller.address, satoshis: 1_000n,
        token: { amount: terms.amount + fee + 1n } }]);
      category = minted.categoryId;
      tokenCoin = minted.utxos[0];
    }
    const params = [seller.publicKey, buyer.publicKey, arbitrator.publicKey, fees.pkh, ...(category ? [category] : [])];
    const funding = (await provider.getUtxos(seller.address)).find((u) => u.vout === 0 && !u.token);
    if (!funding) throw new Error('no funding coin');
    const { contract, tx } = await StatefulContract.deploy(asset === 'bch' ? artifacts.bch : artifacts.token,
      params as never, { provider: provider as never, fundingUtxo: funding, funder: seller.unlockP2PKH(),
        changeAddress: seller.address, initialBalance: terms.reserve,
        initArgs: [terms.amount, terms.feeBps, terms.disputeFee, cancelAfter] as never });
    const sim = new Simulation(asset, terms, provider, people, contract, category, fee);
    sim.log.push({ actor: 'seller', action: 'createEscrow', ok: true, txid: tx.txid, bytes: tx.hex.length / 2 });
    const sc = contract.connect(seller);
    const sig = new SignatureTemplate(seller.privateKey);
    const send = asset === 'bch'
      ? call(sc, 'fund', sig).withValue(terms.amount + fee).send()
      : call(sc, 'deposit', sig, category).addInput(tokenCoin as Utxo, seller.unlockP2PKH())
        .tokenContainerDeposit(category as string, terms.amount + fee + 1n).send();
    const funded = await send;
    sim.log.push({ actor: 'seller', action: asset === 'bch' ? 'fund' : 'deposit', ok: true, txid: funded.txid,
      bytes: funded.hex.length / 2 });
    return sim;
  }

  async status(): Promise<StatusName> {
    const s = await this.sc.getState() as { status: bigint | number };
    return STATUS[Number(s.status)] ?? 'created';
  }

  /** Seconds left before the seller may cancel; 0 once the waiting time has passed. */
  async waitLeft(): Promise<number> {
    const s = await this.sc.getState() as { terms: { sellerCanCancelAfter: bigint } };
    const left = Number(s.terms.sellerCanCancelAfter) - await this.provider.getMedianTimePast();
    return left > 0 ? left : 0;
  }

  /** Moves the mock clock past the seller's waiting time. */
  async passTime(): Promise<void> {
    this.provider.increaseTime(this.terms.waitSeconds + 60n);
    await this.provider.mine(1);
    this.log.push({ actor: 'outsider', action: 'wait', ok: true });
  }

  /** Runs `action` signed by `actor`. A rejection is logged with the contract error's name, not thrown. */
  async act(actor: Actor, action: Action): Promise<LogEntry> {
    let entry: LogEntry;
    try {
      // Call builders are thenable, so they are never returned from an async function.
      const lockTime = await this.provider.getMedianTimePast() - 1;
      const { txid, hex } = await this.build(actor, action, lockTime).send();
      entry = { actor, action, ok: true, txid, bytes: hex.length / 2 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      entry = { actor, action, ok: false, error: rejectionName(message), detail: message.split('\n')[0]?.slice(0, 300) ?? '' };
    }
    this.log.push(entry);
    return entry;
  }

  private build(actor: Actor, action: Action, lockTime: number): CallBuilder {
    const who = this.people[actor];
    const sc = this.sc.connect(who);
    const sig = new SignatureTemplate(who.privateKey);
    const cat = this.category === undefined ? [] : [this.category];
    switch (action) {
      case 'openDispute':
        return call(sc, 'openDispute', sig, actor !== 'seller').withValue(this.terms.disputeFee);
      case 'resolveForBuyer':
      case 'resolveForSeller':
        return call(sc, 'resolveDispute', sig, ...cat, action === 'resolveForBuyer');
      case 'sellerCancel':
        return this.sellerCancel(sc, sig, cat, lockTime);
      default:
        return call(sc, action, sig, ...cat);
    }
  }

  /** `lockTime` is a time-type locktime one second behind the median time past; with a locktime set the SDK takes the payment
   * named by hand (docs/SOLIDCASH-FINDINGS.md, F6). Before the waiting time the VM rejects the locktime (F7). */
  private sellerCancel(sc: Escrow, sig: SignatureTemplate, cat: string[], lockTime: number): CallBuilder {
    const to = lockOf(this.people.seller.address);
    const builder = call(sc, 'sellerCancel', sig, ...cat).setLocktime(lockTime);
    const back = this.terms.amount + this.fee;
    return this.category === undefined ? builder.transfer(to, back)
      : builder.tokenContainerTransfer(this.category, to, back);
  }
}

type CallBuilder = ReturnType<NonNullable<StatefulContract['call'][string]>>;

function call(sc: Escrow, name: string, ...args: unknown[]): CallBuilder {
  const fn = sc.call[name];
  if (fn === undefined) throw new Error(`contract has no entry point ${name}`);
  return fn(...(args as Parameters<typeof fn>));
}

/** FeeMath.tradeFee: basis points of the amount, raised to `floor`. */
export function tradeFee(amount: bigint, feeBps: bigint, floor: bigint): bigint {
  const fee = amount * feeBps / 10_000n;
  return fee < floor ? floor : fee;
}
