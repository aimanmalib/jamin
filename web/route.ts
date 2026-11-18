// Tabs are hash routes (#/try, #/wallet, #/lifecycle, #/contract), so the app is one static page.
import { config } from './data/config.js';

export type Tab = 'home' | 'try' | 'wallet' | 'lifecycle' | 'contract';
export const TABS = config.web.tabs as Tab[];

export function tabFromHash(hash: string): Tab {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (TABS as string[]).includes(name) ? name as Tab : 'home';
}

/** The `?key=value` part of a hash route, such as `#/wallet?trade=…&escrow=…`. */
export function hashQuery(hash: string): URLSearchParams {
  const at = hash.indexOf('?');
  return new URLSearchParams(at === -1 ? '' : hash.slice(at + 1));
}

export function hrefOf(tab: Tab): string {
  return tab === 'home' ? '#/' : `#/${tab}`;
}
