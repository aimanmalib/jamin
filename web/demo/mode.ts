// How the "Release on mainnet" card acts, from the page URL: `?demo=dry` signs and sends nothing, `?demo=mock` runs on
// the mock network (tests); anything else is live. Read from the query string or the hash route's query.
export type DemoMode = 'live' | 'dry' | 'mock';

export function demoMode(search = location.search, hash = location.hash): DemoMode {
  const at = hash.indexOf('?');
  const value = new URLSearchParams(search).get('demo') ?? new URLSearchParams(at === -1 ? '' : hash.slice(at + 1)).get('demo');
  return value === 'dry' || value === 'mock' ? value : 'live';
}
