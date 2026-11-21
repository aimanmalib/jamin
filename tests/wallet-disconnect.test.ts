// A wallet that ends the session must be noticed (docs/decisions/0028): after the wallet is ready, the dapp manager's
// `disconnect` ends the session, `reconnecting` followed by `walletready` within `walletTrade.reconnectGraceMs` keeps
// it, a reconnect that outlasts the grace ends it, and a sign request still waiting when it ends fails at once.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionEnded, watchLink, type LinkSource, type LinkState } from '../web/wallet/link.js';
import { failureText } from '../web/wallet/failure.js';
import { MOCK, mockBackend, mockDrop } from '../web/wallet/mock.js';
import { config } from '../web/data/config.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { lookup } from '../web/text.js';

/** The manager as the link sees it: an event emitter that emits the dapp manager's three events. */
function fakeManager(): EventEmitter & LinkSource {
  return new EventEmitter() as EventEmitter & LinkSource;
}

function watch(graceMs = config.walletTrade.reconnectGraceMs) {
  const dapp = fakeManager();
  const onEnd = vi.fn();
  const link = watchLink(dapp, graceMs, onEnd);
  const seen: LinkState[] = [];
  link.subscribe((s) => { seen.push(s); });
  return { dapp, onEnd, link, seen };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('wallet link after the wallet is ready', () => {
  it('ends when the wallet sends disconnect, once', () => {
    const { dapp, onEnd, link, seen } = watch();
    expect(link.state()).toBe('connected');
    dapp.emit('disconnect', 'user', 'bye');
    dapp.emit('disconnect', 'user', 'bye');
    expect(link.state()).toBe('ended');
    expect(seen).toEqual(['ended']);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stays connected when the wallet comes back within the grace', () => {
    const { dapp, onEnd, link, seen } = watch();
    dapp.emit('reconnecting');
    expect(link.state()).toBe('reconnecting');
    vi.advanceTimersByTime(config.walletTrade.reconnectGraceMs - 1);
    dapp.emit('walletready');
    expect(link.state()).toBe('connected');
    vi.advanceTimersByTime(config.walletTrade.reconnectGraceMs * 2);
    expect(link.state()).toBe('connected');
    expect(seen).toEqual(['reconnecting', 'connected']);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ends a reconnect that outlasts walletTrade.reconnectGraceMs, read from config', () => {
    const { dapp, onEnd, link } = watch();
    dapp.emit('reconnecting');
    vi.advanceTimersByTime(config.walletTrade.reconnectGraceMs - 1);
    expect(link.state()).toBe('reconnecting');
    vi.advanceTimersByTime(1);
    expect(link.state()).toBe('ended');
    expect(onEnd).toHaveBeenCalledTimes(1);
    dapp.emit('walletready');
    expect(link.state()).toBe('ended');
  });

  it('follows another grace value: the number lives in config, not in the code', () => {
    const { dapp, link } = watch(1_000);
    dapp.emit('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(link.state()).toBe('ended');
    expect(config.walletTrade.reconnectGraceMs).toBeGreaterThan(1_000);
  });

  it('fails a sign request still waiting when the session ends, with the language text', async () => {
    const { dapp, link } = watch();
    const never = new Promise<string>(() => undefined);
    const waiting = link.guard(never);
    dapp.emit('disconnect');
    await expect(waiting).rejects.toBeInstanceOf(SessionEnded);
    await expect(link.guard(Promise.resolve('late'))).rejects.toBeInstanceOf(SessionEnded);
    const t = (key: string, vars?: Record<string, string | number>): string => lookup(en, key, vars);
    expect(failureText(t, new SessionEnded())).toBe(en.wallet.endedSign);
  });

  it('passes answers and errors through while connected', async () => {
    const { link } = watch();
    await expect(link.guard(Promise.resolve('signed'))).resolves.toBe('signed');
    await expect(link.guard(Promise.reject(new Error('refused')))).rejects.toThrow('refused');
  });
});

describe('connect timeout and texts', () => {
  it('says the link expired after connectTimeoutMs, in seconds', () => {
    const t = (key: string, vars?: Record<string, string | number>): string => lookup(en, key, vars);
    expect(failureText(t, new Error('timeout'))).toBe(
      lookup(en, 'wallet.timeout', { seconds: config.walletTrade.connectTimeoutMs / 1000 }));
  });

  it('has every new key in English and Malay', () => {
    for (const key of ['reconnecting', 'reconnectingDetail', 'ended', 'endedDetail', 'connectAgain', 'endedSign',
      'timeout', 'tryAgain']) {
      expect(typeof (en.wallet as Record<string, unknown>)[key]).toBe('string');
      expect(typeof (ms.wallet as Record<string, unknown>)[key]).toBe('string');
    }
  });
});

describe('stand-in wallet drops', () => {
  it('reads drop=ended or drop=reconnect from the search or the hash only', () => {
    expect(mockDrop('?wallet=mock&drop=ended', '#/wallet')).toBe('ended');
    expect(mockDrop('', '#/wallet?wallet=mock&drop=reconnect')).toBe('reconnect');
    expect(mockDrop('?drop=back', '')).toBeUndefined();
    expect(mockDrop('', '#/wallet')).toBeUndefined();
  });

  it('drops the connection on demand through the test hook', async () => {
    vi.stubGlobal('window', {});
    try {
      const link = mockBackend().open();
      const hook = (globalThis as unknown as { window: Window }).window.jaminWalletMock;
      hook?.accept();
      const trade = await link.start('wallet-test');
      hook?.drop('reconnect');
      expect(trade.link.state()).toBe('reconnecting');
      hook?.drop('back');
      expect(trade.link.state()).toBe('connected');
      hook?.drop('ended');
      expect(trade.link.state()).toBe('ended');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops by itself after dropAfterMs with &drop=ended', async () => {
    vi.stubGlobal('window', {});
    try {
      const link = mockBackend(false, 'ended').open();
      (globalThis as unknown as { window: Window }).window.jaminWalletMock?.accept();
      const trade = await link.start('wallet-test');
      expect(trade.link.state()).toBe('connected');
      vi.advanceTimersByTime(MOCK.dropAfterMs);
      expect(trade.link.state()).toBe('ended');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
