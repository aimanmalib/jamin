// A WizardConnect wallet whose coins are not at its first address (docs/decisions/0027): the page scans the receive and
// change chains, pays each step from the one address that holds enough, names that address's path in `inputPaths`,
// and checks each signature against that address's key. The role key still comes from `receive/0`, so the same
// wallet and trade give the key they gave before the scan existed (escrows made then can still be resumed).
import { describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import type { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { Status, TERMS, RESERVE_SATS, entry, loadArtifact, satsAt, statusOf, world, type World } from '../test/helpers/escrow.js';
import { FakeWizWallet } from '../test/helpers/wiz-wallet.js';
import { HdTestWallet } from '../test/helpers/hd-wallet.js';
import { asProvider } from '../src/sdk/mock.js';
import { loadConfig } from '../src/config.js';
import { WalletRefusal } from '../src/wallet/protocol-wallet.js';
import { WizardWallet } from '../src/wallet/wizard.js';
import { p2pkhAddress, scanWallet, type ScanChain, type ScanPath } from '../src/wallet/scan.js';
import { keyOf, requireGenesisPayer, requirePayer } from '../src/wallet/payer.js';
import { createEscrow, escrowStatus, fundEscrow, payWith, releaseEscrow, walletSeller, type AddressPrefix }
  from '../src/wallet/wizard-trade.js';

const cfg = loadConfig();
const REQUEST_SATS = 1_000n;
const TRADE = 'wiz-paths';
/** The role public key the code before decision 0027 derived for this wallet, trade, site and message template. */
const ROLE_KEY_BEFORE = '02f8822d40749970d40888f20bc83615692459334f52cee1954ebeb2af48aa624f';
const TXID = (n: number): string => n.toString(16).padStart(64, '0');

/** The mock network as the scan sees it: an address with coins counts as used. */
function mockChain(provider: MockNetworkProvider): ScanChain {
  const coins = async (a: string) => (await provider.getUtxos(a)).filter((u) => !u.token)
    .map((u) => ({ tx_hash: u.txid, tx_pos: u.vout, value: Number(u.satoshis) }));
  return {
    used: async (addresses) => Promise.all(addresses.map(async (a) => (await coins(a)).length > 0)),
    unspent: async (addresses) => Promise.all(addresses.map(coins)),
  };
}

function setup(w: World) {
  const hd = new HdTestWallet();
  const prefix = w.roles.seller.address.split(':')[0] as AddressPrefix;
  const at = (path: ScanPath, index: number): string => p2pkhAddress(hd.publicKey(path, index), prefix);
  const fake = new FakeWizWallet(hd.privateKey('receive', 0), (path, index) => hd.privateKey(path as ScanPath, index));
  const wallet = new WizardWallet(fake, hd.publicKey('receive', 0));
  const scan = async () => scanWallet(hd.keys(), mockChain(w.provider), { ...cfg.walletTrade.scan, prefix,
    category: cfg.tokens.pusd.category });
  return { hd, prefix, at, fake, wallet, scan };
}

function parties(w: World) {
  const { buyer, arbitrator, arbiterB, arbiterC, fees } = w.roles;
  return { buyer: buyer.publicKey, panel: [arbitrator.publicKey, arbiterB.publicKey, arbiterC.publicKey] as const,
    feeRecipientPkh: fees.pkh };
}

describe('seller paying from the address that holds the coins', { timeout: 180_000 }, () => {
  it('creates and funds from change/2 and releases from receive/24, each input signed at its own path', async () => {
    const w = await world();
    const { prefix, at, fake, wallet, scan } = setup(w);
    await w.provider.seedUtxo(at('change', 2), { txid: TXID(1), vout: 0, satoshis: 400_000n });
    await w.provider.seedUtxo(at('receive', 24), { txid: TXID(2), vout: 0, satoshis: 30_000n });
    // A coin at receive/4 keeps the receive chain's gap window open up to the 25th address.
    await w.provider.seedUtxo(at('receive', 4), { txid: TXID(4), vout: 0, satoshis: 1_000n });

    const first = await scan();
    expect(first.sats).toBe(431_000);
    expect(first.addresses.map((a) => `${a.path}/${a.index}`)).toEqual(['receive/4', 'receive/24', 'change/2']);
    const genesis = requireGenesisPayer(first, cfg.walletTrade.minGenesisCoinSats);
    expect(`${genesis.path}/${genesis.index}`).toBe('change/2');
    const s = await walletSeller(asProvider(w.provider), wallet, { template: cfg.walletSigning.roleKeyMessage,
      site: 'jamin.example', trade: TRADE }, prefix, REQUEST_SATS, keyOf(genesis));
    expect(s.address).toBe(at('change', 2));
    expect(binToHex(s.role.publicKey)).toBe(ROLE_KEY_BEFORE);

    const { sc } = await createEscrow(asProvider(w.provider), loadArtifact('JaminEscrow'), s, parties(w),
      { ...TERMS, reserve: RESERVE_SATS }, w.cancelAfter, 10_000n);
    await fundEscrow(sc, s, TERMS.amount);
    expect(await escrowStatus(sc)).toBe(BigInt(Status.Funded));
    await entry(sc.connect(w.roles.buyer), 'markAsPaid', w.sig(w.roles.buyer)).send();

    // The change address is now short of nothing, but pay the release from receive/24 to prove a second path.
    const later = await scan();
    const releaser = requirePayer(later, 20_000);
    const fromReceive = payWith(asProvider(w.provider), s, keyOf(later.addresses.find((a) => a.index === 24 &&
      a.path === 'receive') ?? releaser), prefix, TRADE);
    const before = await satsAt(w.provider, w.roles.buyer.address);
    const beforeRelease = fake.requests.length;
    await releaseEscrow(sc, fromReceive);
    expect(await satsAt(w.provider, w.roles.buyer.address) - before).toBe(TERMS.amount);
    expect(await statusOf(sc)).toBe(Status.Released);

    const paths = fake.requests.map((r) => [...new Set(r.inputPaths.map(([, p, i]) => `${p}/${i}`))].join(','));
    expect(paths[0]).toBe('receive/0');
    // The creation and the deposit at change/2; the release (maybe after a coin split) at receive/24.
    expect(paths.slice(1, beforeRelease)).toEqual(['change/2', 'change/2']);
    expect(paths.slice(beforeRelease).length).toBeGreaterThan(0);
    expect(paths.slice(beforeRelease).every((p) => p === 'receive/24')).toBe(true);
    expect(wallet.signed.length).toBe(fake.requests.length);
  });

  it('refuses a signature made with another key than the one of the input\'s address', async () => {
    const w = await world();
    const { prefix, at, hd, wallet, scan } = setup(w);
    await w.provider.seedUtxo(at('change', 2), { txid: TXID(3), vout: 0, satoshis: 400_000n });
    // A wallet that signs every path with its receive/0 key: the change/2 input does not verify.
    const lazy = new WizardWallet(new FakeWizWallet(hd.privateKey('receive', 0)), hd.publicKey('receive', 0));
    const genesis = requireGenesisPayer(await scan(), cfg.walletTrade.minGenesisCoinSats);
    const text = { template: cfg.walletSigning.roleKeyMessage, site: 'jamin.example', trade: TRADE };
    const s = await walletSeller(asProvider(w.provider), lazy, text, prefix, REQUEST_SATS, keyOf(genesis));
    await expect(createEscrow(asProvider(w.provider), loadArtifact('JaminEscrow'), s, parties(w),
      { ...TERMS, reserve: RESERVE_SATS }, w.cancelAfter, 10_000n)).rejects.toThrow(WalletRefusal);
    expect(wallet.signed.length).toBe(0);
  });
});
