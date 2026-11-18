// The seller trades from a wallet that holds its key behind `bch_signTransaction` (docs/decisions/0009): the wallet
// pays for the escrow's creation and the deposit and signs those inputs itself, and the seller's role key, which
// the contract checks with checkSig, comes from a message the wallet signs. The last test shows why the role key
// is needed: the SDK refuses a call whose contract signature the wallet would fill in (docs/SOLIDCASH-FINDINGS.md, F10).
import { describe, expect, it } from 'vitest';
import { SignatureTemplate, Signer } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { RESERVE_SATS, Status, TERMS, entry, fundingCoin, loadArtifact, satsAt, statusOf, world, type World }
  from './helpers/escrow.js';
import { BCH_FEE } from './helpers/flows.js';
import { asProvider } from '../src/sdk/mock.js';
import { ProtocolWallet } from '../src/wallet/protocol-wallet.js';
import { roleKeyFrom, roleKeyMessage } from '../src/wallet/role-key.js';
import { loadConfig } from '../src/config.js';

const TEMPLATE = loadConfig().walletSigning.roleKeyMessage;

interface WalletSeller {
  wallet: ProtocolWallet;
  /** The SDK's view of the wallet: it composes with placeholders and asks the wallet to sign at broadcast. */
  external: Signer;
  roleKey: Uint8Array;
}

/** The mock seller's coins become a wallet's; the role key comes from the wallet's signature over the trade. */
async function walletSeller(w: World, trade: string): Promise<WalletSeller> {
  const { seller } = w.roles;
  const wallet = new ProtocolWallet(seller.privateKey);
  const external = Signer.external({ wallet, address: seller.address, publicKey: wallet.publicKey,
    userPrompt: 'Jamin escrow' }, asProvider(w.provider));
  const message = roleKeyMessage(TEMPLATE, { site: 'jamin.example', role: 'seller', trade });
  return { wallet, external, roleKey: roleKeyFrom(message, await wallet.signMessage(message), wallet.pkh) };
}

async function openFromWallet(w: World, s: WalletSeller): Promise<StatefulContract> {
  const role = new SignatureTemplate(s.roleKey);
  const { buyer, arbitrator, arbiterB, arbiterC, fees, seller } = w.roles;
  const { contract } = await StatefulContract.deploy(loadArtifact('JaminEscrow'), [role.publicKey, buyer.publicKey,
    arbitrator.publicKey, arbiterB.publicKey, arbiterC.publicKey, fees.pkh] as never, {
    provider: asProvider(w.provider), fundingUtxo: await fundingCoin(w.provider, seller), funder: s.external.unlockP2PKH(),
    changeAddress: seller.address, initialBalance: RESERVE_SATS,
    initArgs: [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter] as never,
  });
  await entry(contract.connect(s.external), 'fund', role).withValue(TERMS.amount + BCH_FEE).send();
  return contract;
}

describe('seller signing with a wallet', () => {
  it('creates, funds and releases an escrow with every seller input signed by the wallet', async () => {
    const w = await world();
    const s = await walletSeller(w, 'wallet-release');
    const sc = await openFromWallet(w, s);
    expect(await statusOf(sc)).toBe(Status.Funded);
    expect(await sc.getBalance()).toBe(RESERVE_SATS + TERMS.amount + BCH_FEE);
    expect(s.wallet.signed.length).toBe(2);

    const { buyer } = w.roles;
    await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
    const before = await satsAt(w.provider, buyer.address);
    const asked = s.wallet.signed.length;
    await entry(sc.connect(s.external), 'release', new SignatureTemplate(s.roleKey)).send();
    expect(await satsAt(w.provider, buyer.address) - before).toBe(TERMS.amount);
    expect(await statusOf(sc)).toBe(Status.Released);
    // The SDK may first split a wallet coin into fee coins, a second transaction the wallet signs.
    expect(s.wallet.signed.length).toBeGreaterThan(asked);
    expect(s.wallet.signed.every((r) => r.userPrompt === 'Jamin escrow' && r.inputs.length > 0)).toBe(true);
  });

  it('refuses a release signed with the wallet key instead of the role key', async () => {
    const w = await world();
    const s = await walletSeller(w, 'wallet-wrong-key');
    const sc = await openFromWallet(w, s);
    await entry(sc.connect(w.roles.buyer), 'markAsPaid', w.sig(w.roles.buyer)).send();
    await expect(entry(sc.connect(s.external), 'release', w.sig(w.roles.seller)).send()).rejects.toThrow(/NotSeller/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('F10: the SDK refuses a call whose seller signature is a placeholder for the wallet to fill', async () => {
    const w = await world();
    const s = await walletSeller(w, 'wallet-placeholder');
    const sc = await openFromWallet(w, s);
    await entry(sc.connect(w.roles.buyer), 'markAsPaid', w.sig(w.roles.buyer)).send();
    /** What a wc2 dapp sends in place of a contract signature: 64 zero bytes and the sighash type. */
    class Placeholder extends SignatureTemplate {
      override generateSignature(): Uint8Array {
        return Uint8Array.of(...new Uint8Array(64), this.sighashType | 0x40);
      }
    }
    await expect(entry(sc.connect(s.external), 'release', new Placeholder(s.roleKey)).send())
      .rejects.toThrow(/preflight failed[\s\S]*NULLFAIL|NotSeller/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });
});
