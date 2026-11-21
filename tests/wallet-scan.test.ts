// The connected wallet's balance comes from every address it uses (docs/decisions/0027): the receive and change chains
// are walked with the gap limit from config, "used" means an address has history, and the total is the sum. The wallet
// is the public BIP39 test phrase (no value anywhere); the chain is a fake that records what it was asked.
import { describe, expect, it } from 'vitest';
import { HdTestWallet } from '../test/helpers/hd-wallet.js';
import { largestAddress, p2pkhAddress, scanLimits, scanWallet, type ScanChain, type ScanOptions, type ScanPath,
  type Unspent } from '../src/wallet/scan.js';
import { NoPayer, genesisPayer, payerFor, requirePayer, summary } from '../src/wallet/payer.js';
import { loadConfig } from '../src/config.js';
import { config as webConfig } from '../web/data/config.js';
import { failureText, shortOfCoins } from '../web/wallet/failure.js';
import { walletMode } from '../web/wallet/types.js';
import en from '../lang/en.json' with { type: 'json' };

const CATEGORY = 'aa'.repeat(32);
const hd = new HdTestWallet();
const addr = (path: ScanPath, index: number): string => p2pkhAddress(hd.publicKey(path, index), 'bitcoincash');

/** A chain where `history` addresses were used once and `coins` hold unspent coins (which also counts as history). */
function fakeChain(history: string[], coins: Record<string, Unspent[]>): ScanChain & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    used: async (addresses) => {
      asked.push(...addresses);
      return Promise.resolve(addresses.map((a) => history.includes(a) || a in coins));
    },
    unspent: async (addresses) => Promise.resolve(addresses.map((a) => coins[a] ?? [])),
  };
}

const coin = (value: number, tx_pos = 0, token?: number): Unspent => ({ tx_hash: 'ab'.repeat(32), tx_pos, value,
  ...(token === undefined ? {} : { token_data: { category: CATEGORY, amount: String(token) } }) });

function options(over: Partial<ScanOptions> = {}): ScanOptions {
  const s = webConfig.walletTrade.scan;
  return { gapLimit: s.gapLimit, maxAddresses: s.maxAddresses, batchSize: s.batchSize, prefix: 'bitcoincash',
    category: CATEGORY, ...over };
}

describe('wallet address scan', () => {
  it('finds a coin at receive/24 (the 25th address) and one at change/2, and sums them', async () => {
    const chain = fakeChain([addr('receive', 4)], { [addr('receive', 24)]: [coin(70_000)],
      [addr('change', 2)]: [coin(30_000, 1)] });
    const r = await scanWallet(hd.keys(), chain, options());
    expect(r.addresses.map((a) => `${a.path}/${a.index}`)).toEqual(['receive/4', 'receive/24', 'change/2']);
    expect(r.sats).toBe(100_000);
    expect(r.paths).toEqual(['receive', 'change']);
    // Each chain stops after gapLimit unused addresses past its last used one.
    expect(r.scanned).toBe(25 + 20 + 3 + 20);
    expect(largestAddress(r)?.index).toBe(24);
  });

  it('reads a balance when receive/0 is empty but a change address holds coins', async () => {
    const r = await scanWallet(hd.keys(), fakeChain([], { [addr('change', 0)]: [coin(12_345)] }), options());
    expect(r.sats).toBe(12_345);
    expect(r.addresses[0]?.address).toBe(addr('change', 0));
  });

  it('honours the gap limit: a coin 26 addresses past the last used one is not found', async () => {
    const r = await scanWallet(hd.keys(), fakeChain([addr('receive', 4)], { [addr('receive', 30)]: [coin(9_000)] }),
      options());
    expect(r.sats).toBe(0);
    expect(r.addresses.map((a) => a.index)).toEqual([4]);
  });

  it('reads the gap limit from config: a wider gap finds the same coin', async () => {
    const chain = (): ScanChain => fakeChain([addr('receive', 4)], { [addr('receive', 30)]: [coin(9_000)] });
    expect((await scanWallet(hd.keys(), chain(), options({ gapLimit: 30 }))).sats).toBe(9_000);
    expect((await scanWallet(hd.keys(), chain(), options({ gapLimit: 3 }))).scanned).toBe(3 + 3);
    expect(loadConfig().walletTrade.scan.gapLimit).toBe(webConfig.walletTrade.scan.gapLimit);
  });

  it('sums token units of the configured category over all addresses', async () => {
    const r = await scanWallet(hd.keys(), fakeChain([], { [addr('receive', 0)]: [coin(1_000, 0, 150)],
      [addr('change', 1)]: [coin(1_000, 1, 100), coin(5_000)] }), options());
    expect(r.tokenUnits).toBe(250);
    expect(r.sats).toBe(7_000);
  });

  it('skips a chain the wallet did not share, and stops at maxAddresses', async () => {
    const onlyReceive = await scanWallet(hd.keys(['receive']), fakeChain([], {}), options());
    expect(onlyReceive.paths).toEqual(['receive']);
    expect(onlyReceive.scanned).toBe(options().gapLimit);
    const many = Array.from({ length: 50 }, (_, i) => addr('receive', i));
    const capped = await scanWallet(hd.keys(), fakeChain(many, {}), options({ maxAddresses: 30 }));
    expect(capped.scanned).toBe(30);
  });

  it('asks no history again for addresses a previous scan found used', async () => {
    const chain = fakeChain([addr('receive', 0)], { [addr('change', 0)]: [coin(5_000)] });
    const first = await scanWallet(hd.keys(), chain, options());
    chain.asked.length = 0;
    const again = await scanWallet(hd.keys(), chain, options(), first);
    expect(again.sats).toBe(first.sats);
    expect(chain.asked).not.toContain(addr('receive', 0));
    expect(chain.asked).not.toContain(addr('change', 0));
  });

  it('refuses limits that are not whole numbers of at least one', () => {
    expect(() => scanLimits({ gapLimit: 0, maxAddresses: 10, batchSize: 1 })).toThrow(/gapLimit/);
    expect(() => scanLimits({ gapLimit: 30, maxAddresses: 10, batchSize: 1 })).toThrow(/maxAddresses/);
  });
});

describe('paying address', () => {
  it('picks the one address that holds enough, and names the shortfall when coins are spread', async () => {
    const r = await scanWallet(hd.keys(), fakeChain([], { [addr('receive', 3)]: [coin(4_000)],
      [addr('change', 2)]: [coin(6_000, 0), coin(3_000, 2)] }), options());
    expect(payerFor(r, 8_000)?.address).toBe(addr('change', 2));
    expect(genesisPayer(r, 5_000)?.address).toBe(addr('change', 2));
    expect(genesisPayer(r, 7_000)).toBeUndefined();
    expect(() => requirePayer(r, 10_000)).toThrow(NoPayer);
    try { requirePayer(r, 10_000); } catch (e) {
      expect(e).toMatchObject({ need: 10_000, total: 13_000, largest: 9_000 });
      expect((e as Error).message).not.toMatch(/bitcoincash:/);
    }
    expect(summary(r, 5_000)).toEqual({ scanned: r.scanned, used: 2, largestSats: 9_000, canCreate: true });
  });

  it('does not count token-carrying coins as satoshis to pay with', async () => {
    const r = await scanWallet(hd.keys(), fakeChain([], { [addr('receive', 0)]: [coin(9_000, 0, 1)] }), options());
    expect(payerFor(r, 1_000)).toBeUndefined();
    expect(summary(r, 1_000).canCreate).toBe(false);
  });
});

describe('wallet tab text', () => {
  const t = (key: string, vars: Record<string, string | number> = {}): string => {
    const text = (en.wallet as Record<string, string>)[key.replace('wallet.', '')] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  };

  it('explains coins spread over addresses and suggests gathering them in the visitor\'s own wallet', () => {
    const spread = shortOfCoins(t, 5_000, 8_000, 4_000);
    expect(spread).toContain('0.00008 BCH');
    expect(spread).toContain('to yourself');
    expect(shortOfCoins(t, 5_000, 3_000, 3_000)).toContain('needs at least 5000 sat');
    expect(failureText(t, new NoPayer(5_000, 8_000, 4_000))).toBe(spread);
  });

  it('takes addresses out of raw errors and turns a shortfall into plain text', () => {
    const raw = new Error('no coin of 5000 sat at output 0 in bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6');
    expect(failureText(t, raw)).toBe(`Stopped: ${en.wallet.failedFunds}`);
    expect(failureText(t, new Error('rejected at bchtest:qq00 by the wallet'))).toBe('Stopped: rejected at … by the wallet');
  });

  it('selects the empty stand-in wallet with ?wallet=mock-empty', () => {
    expect(walletMode('?wallet=mock-empty', '#/wallet')).toBe('mock-empty');
    expect(walletMode('', '#/wallet?wallet=mock-empty')).toBe('mock-empty');
  });

  it('never asks for coins to be sent to the page in the wallet texts', () => {
    for (const text of Object.values(en.wallet)) expect(text).not.toMatch(/send [^.]*to (this|the) (page|site)/i);
  });
});
