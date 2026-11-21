// The seller's side of a BCH escrow traded from a WizardConnect wallet (docs/decisions/0014): the wallet pays for the
// escrow's creation, the deposit and the seller's call fees and signs those inputs; the role key derived from the
// wallet's signature signs the contract's seller check. The page uses it on mainnet, the tests on the mock network.
import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { SignatureTemplate, Signer, type Artifact, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { wizardRoleKey, type WizKey, type WizardWallet } from './wizard.js';
import { p2pkhAddress } from './scan.js';
import { roleKeyMessage } from './role-key.js';

export interface TradeTerms {
  amount: bigint;
  feeBps: bigint;
  disputeFee: bigint;
  waitSeconds: bigint;
  /** Satoshis the escrow's state container keeps. */
  reserve: bigint;
}

/** Public keys of the other parties: the buyer, the arbitration panel (three keys) and the fee recipient's hash. */
export interface Counterparties {
  buyer: Uint8Array;
  panel: readonly [Uint8Array, Uint8Array, Uint8Array];
  feeRecipientPkh: Uint8Array;
}

export interface RoleKeyText { template: string; site: string; trade: string }

export interface WalletSeller {
  wallet: WizardWallet;
  /** The SDK's view of the wallet: pays and has the wallet sign its inputs. */
  external: Signer;
  role: SignatureTemplate;
  /** The wallet address that pays (decision 0027; `receive/0` until another is chosen); its change returns there. */
  address: string;
  message: string;
}

export type AddressPrefix = 'bitcoincash' | 'bchtest' | 'bchreg';

export function walletAddress(wallet: WizardWallet, prefix: AddressPrefix): string {
  const address = lockingBytecodeToCashAddress({ bytecode: wallet.lockingBytecode, prefix });
  if (typeof address === 'string') throw new Error(`wallet lock has no address: ${address}`);
  return address.address;
}

/** The same seller (role key unchanged) paying from the wallet address of `payer`, which the wallet learns. */
export function payWith(provider: NetworkProvider, s: WalletSeller, payer: WizKey, prefix: AddressPrefix,
  trade: string): WalletSeller {
  s.wallet.addKeys([payer]);
  const address = p2pkhAddress(payer.publicKey, prefix);
  const external = Signer.external({ wallet: s.wallet, address, publicKey: payer.publicKey, userPrompt: `Jamin ${trade}` },
    provider);
  return { ...s, external, address };
}

/**
 * Asks the wallet for the role key signature and returns the seller as the SDK sees it. The role key request is
 * always at `receive/0` (decisions 0009, 0027); `payer` picks another address of the wallet to pay from.
 */
export async function walletSeller(provider: NetworkProvider, wallet: WizardWallet, text: RoleKeyText,
  prefix: AddressPrefix, requestSats: bigint, payer?: WizKey): Promise<WalletSeller> {
  const message = roleKeyMessage(text.template, { site: text.site, role: 'seller', trade: text.trade });
  const role = new SignatureTemplate(await wizardRoleKey(wallet, message, requestSats));
  const address = walletAddress(wallet, prefix);
  const external = Signer.external({ wallet, address, publicKey: wallet.publicKey, userPrompt: `Jamin ${text.trade}` },
    provider);
  const s = { wallet, external, role, address, message };
  return payer === undefined ? s : payWith(provider, s, payer, prefix, text.trade);
}

/** A plain wallet coin at output 0 holding at least `min`: what a contract's token genesis has to spend. */
export async function genesisCoin(provider: NetworkProvider, address: string, min: bigint): Promise<Utxo | undefined> {
  const coins = (await provider.getUtxos(address)).filter((u) => u.vout === 0 && !u.token && u.satoshis >= min);
  return coins.sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
}

export class NoGenesisCoin extends Error {}

export async function createEscrow(provider: NetworkProvider, artifact: Artifact, s: WalletSeller, parties: Counterparties,
  terms: TradeTerms, cancelAfter: bigint, minCoin: bigint): Promise<{ sc: StatefulContract; txid: string }> {
  const fundingUtxo = await genesisCoin(provider, s.address, minCoin);
  if (fundingUtxo === undefined) throw new NoGenesisCoin(`no coin of ${minCoin} sat at output 0 in ${s.address}`);
  const params = [s.role.publicKey, parties.buyer, ...parties.panel, parties.feeRecipientPkh];
  const { contract, tx } = await StatefulContract.deploy(artifact, params as never, {
    provider, fundingUtxo, funder: s.external.unlockP2PKH(), changeAddress: s.address, initialBalance: terms.reserve,
    initArgs: [terms.amount, terms.feeBps, terms.disputeFee, cancelAfter] as never,
  });
  return { sc: contract, txid: tx.txid };
}

function entry(sc: StatefulContract, s: WalletSeller, name: 'fund' | 'release'): ReturnType<StatefulContract['call'][string]> {
  const fn = sc.connect(s.external).call[name];
  if (fn === undefined) throw new Error(`contract has no entry point ${name}`);
  return fn(s.role);
}

/** The seller's deposit: the amount plus the escrow fee the contract computed. */
export async function fundEscrow(sc: StatefulContract, s: WalletSeller, amount: bigint): Promise<string> {
  const { fee } = (await sc.getState() as { terms: { fee: bigint } }).terms;
  return (await entry(sc, s, 'fund').withValue(amount + fee).send()).txid;
}

export async function releaseEscrow(sc: StatefulContract, s: WalletSeller): Promise<string> {
  return (await entry(sc, s, 'release').send()).txid;
}

export async function escrowStatus(sc: StatefulContract): Promise<bigint> {
  return BigInt((await sc.getState() as { status: bigint | number }).status);
}
