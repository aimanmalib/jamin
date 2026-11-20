// Keeps the Wallet tab and the header chip current without a refresh button: runs `work` now and then every `ms`
// while the page is visible, and stops while the tab is hidden (docs/decisions/0022).
import { useEffect, useRef } from 'react';
import { config } from '../data/config.js';

/** walletTrade.pollMs from config, held to the range the decision allows. */
export function pollInterval(ms: number = config.walletTrade.pollMs): number {
  const { min, max } = config.walletTrade.pollRangeMs;
  return Number.isFinite(ms) ? Math.min(max, Math.max(min, ms)) : max;
}

export interface Ticker { stop(): void }

/** Calls `work` at once and every `ms` while `doc` is visible; one call at a time; resumes when shown again. */
export function startPolling(work: () => Promise<void>, ms: number, doc: Pick<Document, 'hidden' | 'addEventListener'
  | 'removeEventListener'> = document): Ticker {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  const tick = async (): Promise<void> => {
    timer = undefined;
    if (stopped || doc.hidden || running) return;
    running = true;
    try { await work(); } catch { /* the next tick tries again */ } finally { running = false; }
    if (!stopped && !doc.hidden) timer = setTimeout(() => { void tick(); }, ms);
  };
  const onVisibility = (): void => {
    if (doc.hidden) { if (timer !== undefined) clearTimeout(timer); timer = undefined; } else if (timer === undefined) void tick();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  void tick();
  return { stop: () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
  } };
}

/** `startPolling` for a component: active while `on`; `work` may change between renders. */
export function usePolling(work: () => Promise<void>, on: boolean, ms: number = pollInterval()): void {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => {
    if (!on) return undefined;
    const ticker = startPolling(() => latest.current(), ms);
    return () => { ticker.stop(); };
  }, [on, ms]);
}
