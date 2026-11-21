// The stand-in wallet of `?wallet=mock`, for the end-to-end tests of the Wallet tab: the relay is not contacted, the
// test accepts the connection through `window.jaminWalletMock.accept()`, and the escrow turns from funded to paid by
// itself after a few status reads, as when the buyer marks it paid from their own wallet. Nothing is signed or sent.
// Its coins sit at several addresses, as a real wallet's do (decision 0027): the balance shown is their sum.
// `?wallet=mock-empty` is a wallet with no coins at all.
import type { Balance } from './store.js';
import type { TradeApi, TradeTx, WalletBackend } from './types.js';

export const MOCK = {
  uri: 'wiz://mock?relay=none&session=jamin-test',
  walletName: 'Mock wallet',
  address: 'bitcoincash:qqmockwalletaddressfortheendtoendtestsonly0000000',
  escrow: 'bitcoincash:pqmockescrowaddressfortheendtoendtestsonly000000000',
  /** Coins at receive/0, receive/24 and change/2: the sum is the balance shown. */
  addresses: [{ sats: 0, tokenUnits: 0 }, { sats: 100_000, tokenUnits: 0 }, { sats: 23_456, tokenUnits: 250 }],
  /** Addresses an empty wallet's scan looks at: the gap window of both chains. */
  emptyScanned: 40,
  /** Status reads after the deposit before the escrow shows as paid. */
  paidAfterReads: 2,
};

const STATUS_FUNDED = 1n;
const STATUS_PAID = 2n;
const STATUS_RELEASED = 4n;

function fakeTxid(n: number): string {
  return n.toString(16).padStart(64, '0');
}

class MockTrade implements TradeApi {
  readonly walletName = MOCK.walletName;
  readonly sellerAddress = MOCK.address;
  readonly roleKey = new Uint8Array(33).fill(2);
  readonly txs: TradeTx[] = [];
  private stage = 0n;
  private reads = 0;

  constructor(readonly trade: string, private readonly empty: boolean) {}

  async balance(): Promise<Balance> {
    const held = this.empty ? [] : MOCK.addresses.filter((a) => a.sats > 0);
    const sats = held.reduce((n, a) => n + a.sats, 0);
    return Promise.resolve({ sats, tokenUnits: held.reduce((n, a) => n + a.tokenUnits, 0),
      scan: { scanned: this.empty ? MOCK.emptyScanned : MOCK.emptyScanned + 25, used: held.length,
        largestSats: Math.max(0, ...held.map((a) => a.sats)), canCreate: sats > 0 } });
  }

  hasEscrow(): boolean { return this.txs.length > 0 || this.stage > 0n; }
  async create(): Promise<string> { return this.tx('createEscrow'); }
  async resume(): Promise<void> { this.stage = STATUS_FUNDED; return Promise.resolve(); }
  async fund(): Promise<string> { this.stage = STATUS_FUNDED; return this.tx('fund'); }
  async release(): Promise<string> { this.stage = STATUS_RELEASED; return this.tx('release'); }
  async address(): Promise<string> { return Promise.resolve(MOCK.escrow); }

  async status(): Promise<bigint> {
    if (this.stage === STATUS_FUNDED) {
      this.reads += 1;
      if (this.reads > MOCK.paidAfterReads) this.stage = STATUS_PAID;
    }
    return Promise.resolve(this.stage);
  }

  private async tx(step: TradeTx['step']): Promise<string> {
    const txid = fakeTxid(this.txs.length + 1);
    this.txs.push({ step, txid });
    return Promise.resolve(txid);
  }
}

declare global {
  interface Window { jaminWalletMock?: { accept(): void } }
}

export function mockBackend(empty = false): WalletBackend {
  return {
    open: () => {
      let accept: () => void = () => undefined;
      const accepted = new Promise<void>((resolve) => { accept = resolve; });
      window.jaminWalletMock = { accept: () => { accept(); } };
      return { uri: MOCK.uri, start: async (trade) => { await accepted; return new MockTrade(trade, empty); } };
    },
  };
}
