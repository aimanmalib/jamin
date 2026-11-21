// The connected wallet's link state for React (decision 0028): 'connected' with no wallet at all, so callers need not
// tell the two apart.
import { useSyncExternalStore } from 'react';
import type { LinkState, LinkView } from './link.js';

const none = (): LinkState => 'connected';
const noSubscribe = (): (() => void) => () => undefined;

export function useLinkState(view: LinkView | undefined): LinkState {
  return useSyncExternalStore(view ? view.subscribe : noSubscribe, view ? view.state : none, view ? view.state : none);
}
