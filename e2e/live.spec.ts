import { expect, test } from '@playwright/test';

// Response headers of the deployed site. Only meaningful against the public URL (E2E_BASE_URL): the local
// `vite preview` server sends none of them.
test.skip(!process.env.E2E_BASE_URL, 'runs against a deployed site only');

test('health, security policy and cache headers', async ({ request }) => {
  const health = await request.get('/healthz');
  expect(health.status()).toBe(200);
  expect(await health.text()).toBe('ok\n');

  const home = await request.get('/');
  expect(home.status()).toBe(200);
  const headers = home.headers();
  expect(headers['content-security-policy']).toMatch(/connect-src 'self' wss:\/\/[^;\s]+/);
  expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(headers['cache-control']).toContain('no-transform');
  expect(headers['x-content-type-options']).toBe('nosniff');

  const asset = (await home.text()).match(/\/assets\/[\w.-]+\.js/)?.[0];
  expect(asset, 'the page links a hashed script').toBeTruthy();
  const script = await request.get(asset ?? '');
  expect(script.status()).toBe(200);
  expect(script.headers()['cache-control']).toContain('immutable');
});
