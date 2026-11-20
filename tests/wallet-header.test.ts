// The Wallet tab after the judges' notes (docs/decisions/0022): the WizardConnect link as a QR code, copy, the header
// balance chip and polling that replaces the refresh button.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import qrcode from 'qrcode-generator';
import { qrShape } from '../web/wallet/qr.js';
import { copyText } from '../web/wallet/copy.js';
import { pollInterval, startPolling } from '../web/wallet/poll.js';
import { balanceOf } from '../web/net/utxos.js';
import { formatBalance } from '../web/wallet/format.js';
import { walletMode } from '../web/wallet/types.js';
import { MOCK, mockBackend } from '../web/wallet/mock.js';
import { config } from '../web/data/config.js';

const URI = 'wiz://abc?relay=wss%3A%2F%2Frelay.example&p=02' + 'ab'.repeat(32);

/** Dark modules read back out of the SVG path, as "row,col" without the quiet zone. */
function darkCells(path: string, margin = 4): Set<string> {
  return new Set([...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${Number(m[2]) - margin},${Number(m[1]) - margin}`));
}

describe('WizardConnect QR', () => {
  it('draws exactly the modules of the link at level M, with a quiet zone', () => {
    const q = qrcode(0, 'M');
    q.addData(URI, 'Byte');
    q.make();
    const n = q.getModuleCount();
    const shape = qrShape(URI);
    expect(shape.size).toBe(n + 8);
    const cells = darkCells(shape.path);
    let dark = 0;
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
      expect(cells.has(`${r},${c}`)).toBe(q.isDark(r, c));
      if (q.isDark(r, c)) dark += 1;
    }
    expect(cells.size).toBe(dark);
  });

  it('changes when the link changes', () => {
    expect(qrShape(URI).path).not.toBe(qrShape(`${URI}0`).path);
  });
});

describe('copy', () => {
  it('writes the exact link to the clipboard', async () => {
    const writeText = vi.fn(async () => Promise.resolve());
    await expect(copyText(URI, { clipboard: { writeText } }, undefined)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(URI);
  });

  it('reports failure when the clipboard refuses and there is no page to fall back on', async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error('denied')));
    await expect(copyText(URI, { clipboard: { writeText } }, undefined)).resolves.toBe(false);
  });
});

describe('polling', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reads its interval from config, within the allowed range', () => {
    const { min, max } = config.walletTrade.pollRangeMs;
    expect(pollInterval()).toBe(config.walletTrade.pollMs);
    expect(config.walletTrade.pollMs).toBeGreaterThanOrEqual(min);
    expect(config.walletTrade.pollMs).toBeLessThanOrEqual(max);
    expect(pollInterval(min - 1)).toBe(min);
    expect(pollInterval(max + 1)).toBe(max);
  });

  it('runs at once and on every interval, pauses while the tab is hidden and resumes when shown', async () => {
    vi.useFakeTimers();
    let onVisibility: () => void = () => undefined;
    const doc = { hidden: false, addEventListener: (_: string, f: () => void) => { onVisibility = f; },
      removeEventListener: vi.fn() };
    const work = vi.fn(async () => Promise.resolve());
    const ticker = startPolling(work, 5000, doc as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(work).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(work).toHaveBeenCalledTimes(2);
    doc.hidden = true;
    onVisibility();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(work).toHaveBeenCalledTimes(2);
    doc.hidden = false;
    onVisibility();
    await vi.advanceTimersByTimeAsync(0);
    expect(work).toHaveBeenCalledTimes(3);
    ticker.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(work).toHaveBeenCalledTimes(3);
    expect(doc.removeEventListener).toHaveBeenCalled();
  });
});

describe('header balance', () => {
  const pusd = config.tokens.pusd;

  it('sums satoshis of every coin and token units of the configured category only', () => {
    const unspent = [
      { value: 1000 },
      { value: 800, token_data: { category: pusd.category, amount: '150' } },
      { value: 800, token_data: { category: 'ff'.repeat(32), amount: '9' } },
    ];
    expect(balanceOf(unspent, pusd.category)).toEqual({ sats: 2600, tokenUnits: 150 });
  });

  it('shows BCH, and the token only when the wallet holds some', () => {
    const token = { symbol: 'TKN', category: '', decimals: 2 };
    expect(formatBalance({ sats: 123_456, tokenUnits: 250 }, token)).toEqual({ bch: '0.00123456 BCH', token: '2.50 TKN' });
    expect(formatBalance({ sats: 0, tokenUnits: 0 }, token)).toEqual({ bch: '0.00 BCH', token: '' });
  });
});

describe('mock wallet (?wallet=mock, tests only)', () => {
  it('is chosen only by the explicit parameter', () => {
    expect(walletMode('?wallet=mock', '#/wallet')).toBe('mock');
    expect(walletMode('', '#/wallet?wallet=mock')).toBe('mock');
    expect(walletMode('', '#/wallet')).toBe('live');
    expect(walletMode('?wallet=1', '#/')).toBe('live');
  });

  it('waits for acceptance, then turns funded into paid after a few status reads without a click', async () => {
    const g = globalThis as unknown as { window?: { jaminWalletMock?: { accept(): void } } };
    g.window = {};
    const link = mockBackend().open();
    const started = link.start('wallet-test');
    g.window.jaminWalletMock?.accept();
    const trade = await started;
    await trade.create(new Uint8Array(33));
    await trade.fund();
    const seen: bigint[] = [];
    for (let i = 0; i <= MOCK.paidAfterReads; i += 1) seen.push(await trade.status());
    expect(seen.slice(0, MOCK.paidAfterReads).every((s) => s === 1n)).toBe(true);
    expect(seen.at(-1)).toBe(2n);
    delete g.window;
  });
});

describe('no refresh button', () => {
  it('the Wallet tab and both languages carry no refresh control or text', () => {
    expect(readFileSync('web/ui/WalletTab.tsx', 'utf8')).not.toContain('wallet-refresh');
    for (const lang of ['en', 'ms']) {
      const text = JSON.parse(readFileSync(`lang/${lang}.json`, 'utf8')) as { wallet: Record<string, string> };
      expect(text.wallet.refresh).toBeUndefined();
      expect(text.wallet.copied).toBeTruthy();
    }
  });
});

describe('callers of the Wallet tab', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join(dir, f));
  const files = ['scripts', 'web', 'src'].flatMap(sources).map((f) => ({ f, text: readFileSync(f, 'utf8') }));

  it('scans the scripts that drive the tab', () => {
    expect(files.some(({ f }) => f.endsWith('third-party-wallet.ts'))).toBe(true);
  });

  it('no longer refer to the removed refresh button', () => {
    expect(files.filter(({ text }) => /wallet-refresh|wallet\.refresh/.test(text)).map(({ f }) => f)).toEqual([]);
  });

  it('read the WizardConnect link as text, not as a form field', () => {
    expect(files.filter(({ text }) => /wallet-link['"]\)\s*\.inputValue/.test(text)).map(({ f }) => f)).toEqual([]);
  });
});
