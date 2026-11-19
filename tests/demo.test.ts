// The public demo escrow (docs/decisions/0020-public-demo-escrow.md): the published keys stay capped and unrelated to
// any wallet, a dry release never reaches the network, and the browser's release module stages and releases a demo
// escrow on the mock network with the production profile.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact, NetworkProvider } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { binToHex, deriveHdPath, deriveHdPrivateNodeFromBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import {
  ExposureError, checkExposure, demoKeys, plannedExposure, validDemoConfig, type DemoConfig,
} from '../src/demo/config.js';
import { DryRun, attachDemo, demoStatus, dryProvider, releaseDemo } from '../src/demo/escrow.js';
import { stageDemo, type Pay } from '../src/demo/stage.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';

const jamin = JSON.parse(readFileSync('config/jamin.json', 'utf8')) as {
  escrow: { feeBps: number; disputeFeeSats: number; sellerWaitingTimeSeconds: number; containerReserveSats: number };
  wallet: { derivationBase: string; roles: Record<string, number> };
  walletTrade: { feeRecipientPkh: string };
};
const demo = JSON.parse(readFileSync('config/demo.json', 'utf8')) as DemoConfig;
const FEE_BPS = BigInt(jamin.escrow.feeBps);
/** The cap the plan sets for what public keys may guard (USD 0.05 at the measured rate, rounded down). */
const CAP_SATS = 24_000;
// Public BIP39 test phrase; never holds funds.
const PUBLIC_VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('demo config', () => {
  it('caps what the demo keys can spend at 24,000 sats or less', () => {
    expect(demo.maxSats).toBeLessThanOrEqual(CAP_SATS);
    expect(demo.escrowSats + demo.feeCoinSats.reduce((a, s) => a + s, 0)).toBeLessThanOrEqual(demo.maxSats);
    expect(plannedExposure(demo, FEE_BPS)).toBeLessThanOrEqual(BigInt(demo.maxSats));
    expect(validDemoConfig(demo, FEE_BPS)).toBe(demo);
  });

  it('refuses amounts that would let the demo keys spend more than maxSats', () => {
    expect(() => validDemoConfig({ ...demo, feeCoinSats: [...demo.feeCoinSats, demo.maxSats] }, FEE_BPS))
      .toThrowError(ExposureError);
    expect(() => checkExposure(BigInt(demo.maxSats) + 1n, demo)).toThrowError(/more than maxSats/);
    expect(() => checkExposure(BigInt(demo.maxSats), demo)).not.toThrow();
  });

  it('holds five distinct keys, none derived from a wallet path', () => {
    const keys = Object.values(demo.keys);
    expect(new Set(keys).size).toBe(5);
    // The seed is stretched once; then the first 32 children of the wallet's base path.
    const root = deriveHdPrivateNodeFromBip39Mnemonic(PUBLIC_VECTOR);
    const derived = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      const node = deriveHdPath(root, childPath(jamin.wallet.derivationBase, i));
      if (typeof node === 'string') throw new Error(node);
      derived.add(binToHex(node.privateKey));
    }
    expect(derived.size).toBe(32);
    expect(derived.has(binToHex(deriveKey(PUBLIC_VECTOR, childPath(jamin.wallet.derivationBase, 0)).privateKey))).toBe(true);
    for (const k of keys) expect(derived.has(k)).toBe(false);
  }, 60_000);

  it('is made by a script that reads no wallet', () => {
    const src = readFileSync('scripts/demo-keys.ts', 'utf8');
    expect(src).not.toMatch(/readEnvValue|env-file|MNEMONIC|mnemonic|deriveKey|childPath|\.env/);
    expect(src).toMatch(/crypto\.getRandomValues/);
  });
});

describe('dry release', () => {
  it('refuses every broadcast and keeps the bytes', async () => {
    const send = vi.fn(async () => 'txid');
    const inner = { sendRawTransaction: send, getBlockHeight: async () => 1 } as unknown as NetworkProvider;
    const { provider, taken } = dryProvider(inner);
    await expect(provider.sendRawTransaction('00')).rejects.toBeInstanceOf(DryRun);
    expect(send).not.toHaveBeenCalled();
    expect(taken).toEqual(['00']);
    expect(await provider.getBlockHeight()).toBe(1);
  });
});

describe('demo escrow on the mock network', { timeout: 600_000 }, () => {
  it('stages to paid, signs a dry release that sends nothing, then releases with the same txid', async () => {
    const artifact = JSON.parse(readFileSync('artifacts/solidcash/JaminEscrow.json', 'utf8')) as Artifact;
    const mock = new MockNetworkProvider({ profile: 'production' });
    const provider = mock as unknown as NetworkProvider;
    const [wallet] = await mock.getSigners(1);
    let n = 0;
    const pay: Pay = async (address, amounts) => {
      n += 1;
      const txid = n.toString(16).padStart(64, '0');
      return Promise.all(amounts.map((satoshis, vout) => mock.seedUtxo(address, { txid, vout, satoshis })));
    };
    const parties = { keys: demoKeys(demo, 'bchtest'), feeRecipientPkh: hexToBin(jamin.walletTrade.feeRecipientPkh) };
    const e = jamin.escrow;
    const staged = await stageDemo(provider, artifact, demo, parties, { feeBps: FEE_BPS,
      disputeFee: BigInt(e.disputeFeeSats), waitSeconds: BigInt(e.sellerWaitingTimeSeconds),
      reserve: BigInt(e.containerReserveSats), feeRate: 1 }, pay, wallet?.address ?? '');
    expect(staged.steps.map((s) => s.step)).toEqual(['createEscrow', 'fund', 'markAsPaid']);
    expect(staged.exposure).toBeLessThanOrEqual(BigInt(demo.maxSats));
    const status = async (): Promise<string> => demoStatus(await attachDemo(provider, artifact, parties, staged.address));
    expect(await status()).toBe('paid');

    const sends = (['sendRawTransaction', 'sendPreparedTransaction'] as const)
      .filter((m) => typeof Reflect.get(mock, m) === 'function').map((m) => vi.spyOn(mock, m as 'sendRawTransaction'));
    const dry = await releaseDemo(provider, artifact, parties, staged.address, true);
    expect(dry.sent).toBe(false);
    for (const s of sends) expect(s).not.toHaveBeenCalled();
    expect(await status()).toBe('paid');

    const sent = await releaseDemo(provider, artifact, parties, staged.address, false);
    expect(sent.sent).toBe(true);
    expect(sends.some((s) => s.mock.calls.length > 0)).toBe(true);
    expect(sent.txid).toBe(dry.txid);
    expect(await status()).toBe('released');
  });
});
