// How the simulated seller signs. With a plain key the mock seller signs everything. With a wallet (decision 0009)
// a protocol test wallet in this page holds the seller's coins and signs their inputs over `bch_signTransaction`,
// the way a phone wallet would over WalletConnect, and the escrow names a role key derived from the wallet's
// `bch_signMessage` signature over the trade.
import { SignatureTemplate, Signer, type NetworkProvider } from '@solidcash/solidcash';
import type { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { ProtocolWallet } from '../../src/wallet/protocol-wallet.js';
import { roleKeyFrom, roleKeyMessage } from '../../src/wallet/role-key.js';

export type SellerMode = 'key' | 'wallet';
export const SELLER_MODES: readonly SellerMode[] = ['key', 'wallet'];

type MockSigner = Awaited<ReturnType<MockNetworkProvider['getSigners']>>[number];

export interface SellerKeys {
  mode: SellerMode;
  /** Pays for and signs the seller's P2PKH inputs. */
  connect: Signer;
  /** Signs the contract's seller check. */
  sig: SignatureTemplate;
  /** The key the escrow names as seller; payments back to the seller go to its P2PKH address. */
  publicKey: Uint8Array;
  wallet?: ProtocolWallet;
  /** The message the wallet signed for the role key. */
  message?: string;
}

export interface RoleKeyText { template: string; site: string; trade: string }

export async function sellerKeys(mode: SellerMode, seller: MockSigner, provider: MockNetworkProvider,
  text: RoleKeyText): Promise<SellerKeys> {
  if (mode === 'key') {
    const sig = new SignatureTemplate(seller.privateKey);
    return { mode, connect: seller, sig, publicKey: seller.publicKey };
  }
  const wallet = new ProtocolWallet(seller.privateKey);
  const connect = Signer.external({ wallet, address: seller.address, publicKey: wallet.publicKey,
    userPrompt: text.trade }, provider as unknown as NetworkProvider);
  const message = roleKeyMessage(text.template, { site: text.site, role: 'seller', trade: text.trade });
  const sig = new SignatureTemplate(roleKeyFrom(message, await wallet.signMessage(message), wallet.pkh));
  return { mode, connect, sig, publicKey: sig.publicKey, wallet, message };
}

/** Inputs the wallet signed since it had answered `since` requests. */
export function walletInputsSince(keys: SellerKeys, since: number): number {
  return (keys.wallet?.signed.slice(since) ?? []).reduce((a, r) => a + r.inputs.length, 0);
}
