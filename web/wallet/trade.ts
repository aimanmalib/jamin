// One mainnet escrow traded from a WizardConnect wallet, step by step, for the "Wallet" tab: the wallet signs the
// role key request, the creation, the deposit and the release; the buyer marks the trade paid from their own wallet;
// this page broadcasts each transaction to the Electrum server in config/jamin.json. It holds no wallet key; the role
// key lives in this page's memory only and is derived again from the same wallet and trade name.
import { hexToBin } from '@bitauth/libauth';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import type { StatefulContract } from '@solidcash/solidcash/stateful';
import { WizardWallet } from '../../src/wallet/wizard.js';
import {
  createEscrow, escrowStatus, fundEscrow, releaseEscrow, walletSeller, type Counterparties, type TradeTerms,
  type WalletSeller,
} from '../../src/wallet/wizard-trade.js';
import { artifact } from '../sim/load.js';
import { config } from '../data/config.js';
import type { WizSession } from './session.js';

export type TradeStep = 'createEscrow' | 'fund' | 'release';

export interface TradeTx { step: TradeStep; txid: string }

export function tradeTerms(): TradeTerms {
  const e = config.escrow;
  return { amount: BigInt(config.walletTrade.amountSats), feeBps: BigInt(e.feeBps), disputeFee: BigInt(e.disputeFeeSats),
    waitSeconds: BigInt(e.sellerWaitingTimeSeconds), reserve: BigInt(e.containerReserveSats) };
}

/** A compressed public key in hex, or undefined. */
export function parsePublicKey(hex: string): Uint8Array | undefined {
  const clean = hex.trim().toLowerCase();
  return /^0[23][0-9a-f]{64}$/.test(clean) ? hexToBin(clean) : undefined;
}

export function counterparties(buyer: Uint8Array): Counterparties {
  const [a, b, c] = config.walletTrade.panel.map(hexToBin);
  if (!a || !b || !c || config.walletTrade.panel.length !== 3) throw new Error('walletTrade.panel needs three keys');
  return { buyer, panel: [a, b, c], feeRecipientPkh: hexToBin(config.walletTrade.feeRecipientPkh) };
}

export function mainnetProvider(): NetworkProvider {
  const s = config.electrum.mainnet;
  return new ElectrumNetworkProvider(Network.MAINNET, { hostname: s.hostname, port: s.port,
    encrypted: s.scheme === 'wss' }) as unknown as NetworkProvider;
}

export class WalletTrade {
  sc: StatefulContract | undefined;
  readonly txs: TradeTx[] = [];

  private constructor(readonly provider: NetworkProvider, readonly seller: WalletSeller, readonly trade: string,
    readonly walletName: string) {}

  /** Waits for the wallet, then asks it to sign the role key request for `trade`. */
  static async start(session: WizSession, trade: string, provider = mainnetProvider()): Promise<WalletTrade> {
    const { walletName, publicKey } = await session.ready;
    const wallet = new WizardWallet(session.transport, publicKey);
    const seller = await walletSeller(provider, wallet, { template: config.walletSigning.roleKeyMessage,
      site: new URL(config.site.url).host, trade }, 'bitcoincash', BigInt(config.walletTrade.roleKeyRequestSats));
    return new WalletTrade(provider, seller, trade, walletName);
  }

  async create(buyer: Uint8Array): Promise<string> {
    const terms = tradeTerms();
    const now = BigInt(await this.provider.getMedianTimePast());
    const { sc, txid } = await createEscrow(this.provider, await artifact('JaminEscrow'), this.seller,
      counterparties(buyer), terms, now + terms.waitSeconds, BigInt(config.walletTrade.minGenesisCoinSats));
    this.sc = sc;
    this.txs.push({ step: 'createEscrow', txid });
    return txid;
  }

  async fund(): Promise<string> {
    const txid = await fundEscrow(this.contract(), this.seller, tradeTerms().amount);
    this.txs.push({ step: 'fund', txid });
    return txid;
  }

  async status(): Promise<bigint> {
    return escrowStatus(this.contract());
  }

  async release(): Promise<string> {
    const txid = await releaseEscrow(this.contract(), this.seller);
    this.txs.push({ step: 'release', txid });
    return txid;
  }

  async address(): Promise<string> {
    return this.contract().getAddress();
  }

  private contract(): StatefulContract {
    if (this.sc === undefined) throw new Error('no escrow yet');
    return this.sc;
  }
}
