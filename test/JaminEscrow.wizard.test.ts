// The seller trades from a WizardConnect wallet (docs/decisions/0014). The wallet here is a stand-in that reads the
// relay's wire form and signs the inputs named in `inputPaths`, as Cashonize does; the adapter checks its
// signatures and derives the role key from its signature over a fixed request that cannot be broadcast.
import { describe, expect, it } from 'vitest';
import { binToHex, decodeTransaction, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { SignatureTemplate } from '@solidcash/solidcash';
import { Status, TERMS, RESERVE_SATS, entry, loadArtifact, satsAt, statusOf, world, type World } from './helpers/escrow.js';
import { FakeWizWallet } from './helpers/wiz-wallet.js';
import { asProvider } from '../src/sdk/mock.js';
import { loadConfig } from '../src/config.js';
import { WalletRefusal } from '../src/wallet/protocol-wallet.js';
import { WIZ_SIGHASH, WizardWallet, roleKeyRequest, toWire, wizardRoleKey } from '../src/wallet/wizard.js';
import { createEscrow, escrowStatus, fundEscrow, releaseEscrow, walletSeller, type AddressPrefix }
  from '../src/wallet/wizard-trade.js';

const TEMPLATE = loadConfig().walletSigning.roleKeyMessage;
const REQUEST_SATS = 1_000n;

async function seller(w: World, trade: string, fake = new FakeWizWallet(w.roles.seller.privateKey)) {
  const wallet = new WizardWallet(fake, w.roles.seller.publicKey);
  const prefix = w.roles.seller.address.split(':')[0] as AddressPrefix;
  const s = await walletSeller(asProvider(w.provider), wallet, { template: TEMPLATE, site: 'jamin.example', trade },
    prefix, REQUEST_SATS);
  return { s, fake };
}

function parties(w: World) {
  const { buyer, arbitrator, arbiterB, arbiterC, fees } = w.roles;
  return { buyer: buyer.publicKey, panel: [arbitrator.publicKey, arbiterB.publicKey, arbiterC.publicKey] as const,
    feeRecipientPkh: fees.pkh };
}

describe('seller signing with a WizardConnect wallet', () => {
  it('creates, funds and releases an escrow with every seller input signed over WizardConnect', async () => {
    const w = await world();
    const { s, fake } = await seller(w, 'wiz-release');
    expect(s.address).toBe(w.roles.seller.address);
    const terms = { ...TERMS, reserve: RESERVE_SATS };
    const { sc } = await createEscrow(asProvider(w.provider), loadArtifact('JaminEscrow'), s, parties(w), terms,
      w.cancelAfter, 10_000n);
    await fundEscrow(sc, s, TERMS.amount);
    expect(await escrowStatus(sc)).toBe(BigInt(Status.Funded));

    const { buyer } = w.roles;
    await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
    const before = await satsAt(w.provider, buyer.address);
    await releaseEscrow(sc, s);
    expect(await satsAt(w.provider, buyer.address) - before).toBe(TERMS.amount);
    expect(await statusOf(sc)).toBe(Status.Released);
    // The role key request, the creation, the deposit and the release (maybe after a coin split) went to the wallet,
    // each naming only the wallet's own inputs at receive/0 and none of the contract's.
    expect(fake.requests.length).toBeGreaterThanOrEqual(4);
    for (const r of fake.requests) {
      expect(r.inputPaths.length).toBeGreaterThan(0);
      expect(r.inputPaths.every(([, path, index]) => path === 'receive' && index === 0)).toBe(true);
      expect(r.transaction.broadcast).toBe(false);
    }
    expect(s.wallet.signed.length).toBe(fake.requests.length);
  });

  it('gives the same role key for the same trade and another for another trade', async () => {
    const w = await world();
    const a = await seller(w, 'wiz-same');
    const b = await seller(w, 'wiz-same');
    const c = await seller(w, 'wiz-other');
    expect(binToHex(a.s.role.publicKey)).toBe(binToHex(b.s.role.publicKey));
    expect(binToHex(a.s.role.publicKey)).not.toBe(binToHex(c.s.role.publicKey));
    expect(binToHex(a.s.role.publicKey)).not.toBe(binToHex(w.roles.seller.publicKey));
  });

  it('builds a role key request that spends an outpoint named by the message, shown as the prompt', () => {
    const lock = Uint8Array.of(0x76, 0xa9, 0x14, ...new Uint8Array(20), 0x88, 0xac);
    const r = roleKeyRequest('Jamin role key\nTrade: x', lock, REQUEST_SATS);
    const id = sha256.hash(utf8ToBin('Jamin role key\nTrade: x'));
    expect(binToHex(r.transaction.inputs[0]?.outpointTransactionHash ?? Uint8Array.of())).toBe(binToHex(id));
    expect(r.transaction.outputs[0]?.valueSatoshis).toBe(0n);
    expect(r.transaction.outputs[0]?.lockingBytecode[0]).toBe(0x6a);
    expect(r.userPrompt).toBe('Jamin role key\nTrade: x');
  });

  it('signs with the WizardConnect hash type and returns the signature the wallet made', async () => {
    const w = await world();
    const { fake } = await seller(w, 'wiz-hashtype');
    const [first] = fake.requests;
    if (first === undefined) throw new Error('no request');
    const signed = decodeTransaction(hexToBin((await fake.signTransaction(first)).signedTransaction));
    if (typeof signed === 'string') throw new Error(signed);
    expect(signed.inputs[0]?.unlockingBytecode[65]).toBe(WIZ_SIGHASH);
  });

  it('refuses a wallet that signs with a key other than the one it shared', async () => {
    const w = await world();
    const other = new FakeWizWallet(w.roles.outsider.privateKey);
    const wallet = new WizardWallet(other, w.roles.seller.publicKey);
    await expect(wizardRoleKey(wallet, 'Jamin role key', REQUEST_SATS)).rejects.toThrow(WalletRefusal);
  });

  it('refuses a release signed with the wallet key instead of the role key', async () => {
    const w = await world();
    const { s } = await seller(w, 'wiz-wrong-key');
    const { sc } = await createEscrow(asProvider(w.provider), loadArtifact('JaminEscrow'), s, parties(w),
      { ...TERMS, reserve: RESERVE_SATS }, w.cancelAfter, 10_000n);
    await fundEscrow(sc, s, TERMS.amount);
    await entry(sc.connect(w.roles.buyer), 'markAsPaid', w.sig(w.roles.buyer)).send();
    await expect(entry(sc.connect(s.external), 'release', new SignatureTemplate(w.roles.seller.privateKey)).send())
      .rejects.toThrow(/NotSeller/);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('encodes bytes as hex and integers as <bigint: Nn> on the wire', () => {
    expect(toWire({ a: Uint8Array.of(1, 255), b: 5n, c: undefined, d: [2n] })).toEqual({ a: '01ff', b: '<bigint: 5n>',
      d: ['<bigint: 2n>'] });
  });
});
