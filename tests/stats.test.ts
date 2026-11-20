// The Home stats strip (decision 0023): every recorded number is counted from examples/mainnet.json, the block height
// comes from Electrum (or the `?stats=mock` stand-in), and the locked amounts were read from the chain's transactions.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mainnet from '../examples/mainnet.json' with { type: 'json' };
import config from '../config/jamin.json' with { type: 'json' };
import {
  bchText, recordedStats, releaseCount, secondsAgo, statsPollMs, tokenText, unrecordedPool, unreleasedDemo,
} from '../web/data/stats.js';
import type { MainnetRun } from '../web/data/examples.js';
import { mockTip, statsMode, tipHeight } from '../web/net/tip.js';
import { lockedOf, unlockedTxids, withLocked, type VerboseOutput } from '../src/lifecycle/locked.js';

interface RawStep { step: string; refused?: boolean; lockedSats?: number; lockedUnits?: number }
const raw = mainnet as unknown as { escrows: { asset: string; address?: string; steps: RawStep[] }[] };
const run = mainnet as unknown as MainnetRun;

describe('recorded numbers', () => {
  it('match a plain count over examples/mainnet.json', () => {
    const steps = raw.escrows.flatMap((e) => e.steps);
    expect(recordedStats(run)).toEqual({
      escrows: raw.escrows.length,
      lockedSats: steps.filter((s) => s.step === 'fund' && !s.refused).reduce((a, s) => a + (s.lockedSats ?? 0), 0),
      lockedUnits: steps.filter((s) => s.step === 'deposit' && !s.refused).reduce((a, s) => a + (s.lockedUnits ?? 0), 0),
      refused: steps.filter((s) => s.refused === true).length,
    });
  });

  it('every fund step records satoshis and every deposit token units, BCH and tokens never mixed', () => {
    for (const e of raw.escrows) {
      for (const s of e.steps.filter((x) => (x.step === 'fund' || x.step === 'deposit') && !x.refused)) {
        if (e.asset === 'BCH') { expect(s.lockedSats, s.step).toBeGreaterThan(0); expect(s.lockedUnits).toBeUndefined(); }
        else { expect(s.lockedUnits, s.step).toBeGreaterThan(0); expect(s.lockedSats).toBeUndefined(); }
      }
    }
    expect(unlockedTxids(raw as never)).toEqual([]);
  });

  it('follow the file: one more escrow or refused call changes the numbers', () => {
    const before = recordedStats(run);
    const more: MainnetRun = { escrows: [...run.escrows, { branch: 'Z', asset: 'BCH', steps: [
      { step: 'fund', txid: 'aa', lockedSats: 1000 },
      { step: 'release', refused: true, by: 'buyer', expected: 'NotSeller', rawTxHash: 'bb', serverError: 'x', at: 'y' },
    ] }] };
    expect(recordedStats(more)).toEqual({ ...before, escrows: before.escrows + 1, lockedSats: before.lockedSats + 1000,
      refused: before.refused + 1 });
  });

  it('the strip renders no number of its own: no digit literals in the component', () => {
    const src = readFileSync('web/ui/StatsStrip.tsx', 'utf8').replace(/\/\/.*$/gm, '');
    expect(src.match(/(?<![\w.])\d{2,}(?![\w])/g) ?? []).toEqual([]);
  });

  it('counts pool escrows the host lists that the file does not record, each once', () => {
    const recorded = run.escrows.find((e) => e.address)?.address as string;
    expect(unrecordedPool([recorded, 'bitcoincash:pnew', 'bitcoincash:pnew'], run)).toBe(1);
    expect(unrecordedPool([], run)).toBe(0);
  });
});

describe('releases on mainnet', () => {
  const raw2 = mainnet as unknown as { escrows: { address?: string; demo?: boolean; steps: RawStep[] }[] };
  const plain = raw2.escrows.flatMap((e) => e.steps).filter((s) => s.step === 'release' && !s.refused).length;
  const demoWaiting = raw2.escrows.filter((e) => e.demo === true && e.address
    && !e.steps.some((s) => s.step === 'release' && !s.refused)).map((e) => e.address as string);

  it('count the release steps the file records, a refused one not counted', () => {
    expect(releaseCount([], run)).toBe(plain);
    expect(plain).toBeGreaterThan(0);
  });

  it('add a demo escrow seen released once, and never one the file already records', () => {
    const recordedRelease = raw2.escrows.find((e) => e.address && e.steps.some((s) => s.step === 'release' && !s.refused));
    const fresh = 'bitcoincash:pseen';
    expect(releaseCount([fresh, fresh], run)).toBe(plain + 1);
    expect(releaseCount([recordedRelease?.address as string], run)).toBe(plain);
  });

  it('asks the chain only about demo escrows with no recorded release, the pool list added once', () => {
    expect(unreleasedDemo([], run)).toEqual(demoWaiting);
    expect(unreleasedDemo([...demoWaiting, 'bitcoincash:pnew'], run)).toEqual([...demoWaiting, 'bitcoincash:pnew']);
    const released = raw2.escrows.find((e) => e.address && e.steps.some((s) => s.step === 'release'))?.address as string;
    expect(unreleasedDemo([released], run)).not.toContain(released);
  });
});

describe('formatting and polling', () => {
  it('BCH with eight places and PUSD with its decimals, grouped by locale', () => {
    expect(bchText(163914, 'en-US')).toBe('0.00163914');
    expect(bchText(123456789, 'en-US')).toBe('1.23456789');
    expect(tokenText(23, 2, 'en-US')).toBe('0.23');
    expect(tokenText(23, 2, 'ms-MY')).toBe('0.23');
  });

  it('seconds ago never negative', () => {
    expect(secondsAgo(10_000, 14_999)).toBe(4);
    expect(secondsAgo(10_000, 9_000)).toBe(0);
  });

  it('poll interval from config, held to its range; mock mode uses mockPollMs', () => {
    expect(statsPollMs('live', config.stats)).toBe(config.stats.pollMs);
    expect(statsPollMs('live', { ...config.stats, pollMs: 1 })).toBe(config.stats.pollRangeMs.min);
    expect(statsPollMs('live', { ...config.stats, pollMs: Number.NaN })).toBe(config.stats.pollRangeMs.max);
    expect(statsPollMs('mock', config.stats)).toBe(config.stats.mockPollMs);
  });

  it('mock tip grows by one each call; the mode comes from the query or the hash route', async () => {
    const tip = mockTip(5);
    expect([await tip.height(), await tip.height()]).toEqual([5, 6]);
    expect(statsMode('?stats=mock', '')).toBe('mock');
    expect(statsMode('', '#/home?stats=mock')).toBe('mock');
    expect(statsMode('', '#/home')).toBe('live');
  });

  it('reads the height of a get_tip reply and refuses one without it', () => {
    expect(tipHeight({ height: 978124, hex: '00' })).toBe(978124);
    expect(() => tipHeight({})).toThrow();
    expect(() => tipHeight(null)).toThrow();
  });
});

describe('locked amount of a fund or deposit transaction', () => {
  const nft = (v: number): VerboseOutput => ({ value: v / 1e8, tokenData: { category: 'c', amount: '0' } });
  it('BCH: the one plain output before the change', () => {
    expect(lockedOf([nft(1200), nft(1200), { value: 0.00021546 }, nft(1200), { value: 0.002 }], 'BCH', 'p'))
      .toEqual({ lockedSats: 21546 });
    expect(() => lockedOf([{ value: 0.0001 }, { value: 0.0002 }, { value: 0.1 }], 'BCH', 'p')).toThrow();
  });
  it('token: the units of the token category, never satoshis', () => {
    expect(lockedOf([nft(1200), { value: 0.00000576 }, { value: 0.000012, tokenData: { category: 'p', amount: '12' } },
      { value: 0.0004 }], 'PUSD', 'p')).toEqual({ lockedUnits: 12 });
    expect(() => lockedOf([{ value: 0.0001 }], 'PUSD', 'p')).toThrow();
  });
  it('withLocked fills only the named locking steps', () => {
    const rec = { escrows: [{ asset: 'BCH', steps: [{ step: 'createEscrow', txid: 'a' }, { step: 'fund', txid: 'b' }] }] };
    expect(unlockedTxids(rec)).toEqual(['b']);
    const out = withLocked(rec, new Map([['b', { lockedSats: 7 }]]));
    expect(out.escrows[0]?.steps[1]).toEqual({ step: 'fund', txid: 'b', lockedSats: 7 });
    expect(unlockedTxids(out)).toEqual([]);
  });
});
