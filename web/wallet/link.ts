// Whether a connected WizardConnect wallet is still there (docs/decisions/0028). After the wallet is ready the dapp
// manager keeps reporting: `reconnecting` when the relay drops or the wallet stops answering pings, `walletready` again
// when the wallet comes back, and `disconnect` when the wallet ends the session. This turns those into one state the
// page shows, ends a reconnect that lasts longer than `walletTrade.reconnectGraceMs`, and fails any request still
// waiting for the wallet at once when the session ends, instead of leaving it hanging. Free of SDK imports.

export type LinkState = 'connected' | 'reconnecting' | 'ended';

/** A request to the wallet that can no longer be answered: the session ended while it waited. */
export class SessionEnded extends Error {
  constructor() {
    super('the wallet ended the connection');
    this.name = 'SessionEnded';
  }
}

/** The part of the dapp manager this listens to (its events after `walletready`). */
export interface LinkSource {
  on(event: 'walletready' | 'reconnecting' | 'disconnect', listener: () => void): unknown;
}

/** What the page reads: the state now and changes to it. */
export interface LinkView {
  state(): LinkState;
  subscribe(listener: (state: LinkState) => void): () => void;
}

export interface Link extends LinkView {
  /** Runs `work` but rejects with SessionEnded as soon as the session ends. */
  guard<T>(work: Promise<T>): Promise<T>;
  /** Ends the session from this side (idempotent). */
  end(): void;
}

/** Watches `source` from the moment the wallet is ready; `onEnd` runs once, when the session ends. */
export function watchLink(source: LinkSource, graceMs: number, onEnd: () => void): Link {
  let state: LinkState = 'connected';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(s: LinkState) => void>();
  const waiting = new Set<(e: Error) => void>();
  const set = (next: LinkState): void => {
    if (state === next) return;
    state = next;
    for (const l of listeners) l(next);
  };
  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const end = (): void => {
    if (state === 'ended') return;
    stopTimer();
    set('ended');
    for (const reject of waiting) reject(new SessionEnded());
    waiting.clear();
    onEnd();
  };
  source.on('reconnecting', () => {
    if (state !== 'connected') return;
    set('reconnecting');
    timer = setTimeout(end, graceMs);
  });
  source.on('walletready', () => {
    if (state !== 'reconnecting') return;
    stopTimer();
    set('connected');
  });
  source.on('disconnect', end);
  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    guard: async <T>(work: Promise<T>): Promise<T> => {
      if (state === 'ended') {
        work.catch(() => undefined);
        throw new SessionEnded();
      }
      let reject: (e: Error) => void = () => undefined;
      const ended = new Promise<never>((_, r) => { reject = r; });
      waiting.add(reject);
      try {
        return await Promise.race([work, ended]);
      } finally {
        waiting.delete(reject);
      }
    },
    end,
  };
}
