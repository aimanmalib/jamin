// Events between the demo card and the stats strip. No SDK import, so the strip does not pull in the release code.

/** Fired on `window` after this page sends a release; `detail` is the escrow address. */
export const RELEASED_EVENT = 'jamin:released';

export function announceRelease(address: string): void {
  dispatchEvent(new CustomEvent(RELEASED_EVENT, { detail: address }));
}
