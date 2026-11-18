// Branch W: branch A with the seller trading from a wallet (docs/decisions/0009). The seller's HD key sits behind
// the protocol test wallet, which signs over `bch_signTransaction` and `bch_signMessage` as a phone wallet would.
// The wallet pays for the escrow's creation, the deposit and the release fee and signs those inputs; the escrow
// names a role key derived from the wallet's signature over the trade, and that key signs the seller's calls.
import { SignatureTemplate, Signer } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { loadConfig } from '../config.js';
import { ProtocolWallet } from '../wallet/protocol-wallet.js';
import { roleKeyFrom, roleKeyMessage } from '../wallet/role-key.js';
import { Status } from './branches.js';
import { PANEL, call, check, loadArtifact, satsAt, type Ctx, type Party, type Step } from './context.js';

export interface WalletBranchOptions {
  /** `walletSigning.roleKeyMessage` from config/jamin.json. */
  template: string;
  /** The site named in the role key message. */
  site: string;
  /** Names the trade in the role key message; the same name gives the same role key again. */
  trade: string;
}

const BRANCH = 'W';

/** The role key message from config/jamin.json, naming the site's host and a trade made from the network and time. */
export async function defaultWalletOptions(ctx: Ctx): Promise<WalletBranchOptions> {
  const cfg = loadConfig();
  return { template: cfg.walletSigning.roleKeyMessage, site: new URL(cfg.site.url).host,
    trade: `${ctx.network}-W-${await ctx.provider.getMedianTimePast()}` };
}

export async function branchW(ctx: Ctx, options?: WalletBranchOptions): Promise<void> {
  const o = options ?? await defaultWalletOptions(ctx);
  const { seller, buyer, fees } = ctx.parties;
  const wallet = new ProtocolWallet(seller.signer.privateKey);
  const external = Signer.external({ wallet, address: seller.address, publicKey: wallet.publicKey,
    userPrompt: `Jamin escrow ${o.trade}` }, ctx.provider);
  const message = roleKeyMessage(o.template, { site: o.site, role: 'seller', trade: o.trade });
  const role = new SignatureTemplate(roleKeyFrom(message, await wallet.signMessage(message), wallet.pkh));
  // The wallet pays and signs its inputs; the role key signs the contract's seller check.
  const walletSeller: Party = { signer: external, sig: role, ecdsa: role, publicKey: role.publicKey,
    address: external.address };
  const record = (s: Omit<Step, 'branch'>): void => { ctx.record({ branch: BRANCH, ...s }); };

  const now = BigInt(await ctx.provider.getMedianTimePast());
  const params = [role.publicKey, buyer.publicKey, ...PANEL.map((n) => ctx.parties[n].publicKey), fees.signer.pkh];
  const { contract: sc, tx } = await StatefulContract.deploy(loadArtifact('JaminEscrow'), params as never, {
    provider: ctx.provider, fundingUtxo: await ctx.genesisCoin('seller'), funder: external.unlockP2PKH(),
    changeAddress: seller.address, initialBalance: ctx.terms.reserve,
    initArgs: [ctx.terms.amount, ctx.terms.feeBps, ctx.terms.disputeFee, now + ctx.terms.waitSeconds] as never,
  });
  record({ step: 'createEscrow', txid: tx.txid, escrow: await sc.getAddress(), signer: 'wallet' });

  const { fee } = (await sc.getState() as { terms: { fee: bigint } }).terms;
  const fund = await call(sc, walletSeller, 'fund').withValue(ctx.terms.amount + fee).send();
  record({ step: 'fund', txid: fund.txid, signer: 'wallet' });
  const paid = await call(sc, buyer, 'markAsPaid').send();
  record({ step: 'markAsPaid', txid: paid.txid });

  const before = await satsAt(ctx.provider, buyer.address);
  const release = await call(sc, walletSeller, 'release').send();
  record({ step: 'release', txid: release.txid, signer: 'wallet' });
  check(await satsAt(ctx.provider, buyer.address) - before === ctx.terms.amount, 'W: the buyer receives the amount');
  check(BigInt((await sc.getState() as { status: bigint | number }).status) === Status.Released, 'W: released');
  check(wallet.signed.length >= 3, 'W: the wallet signed the creation, the deposit and the release');
}

