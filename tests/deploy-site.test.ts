import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { cspHeader, electrumOrigin, renderTemplate } from '../src/deploy/site.js';

const server = { hostname: 'electrum.example', port: 50004, scheme: 'wss' as const, timeoutMs: 1000 };

describe('content security policy', () => {
  it('adds the Electrum origin to connect-src once', () => {
    const header = cspHeader({ 'default-src': ["'self'"], 'connect-src': ["'self'"] }, server);
    expect(header).toBe("default-src 'self'; connect-src 'self' wss://electrum.example:50004");
    const again = cspHeader({ 'connect-src': ["'self'", electrumOrigin(server)] }, server);
    expect(again).toBe("connect-src 'self' wss://electrum.example:50004");
  });

  it('creates connect-src when the policy has none', () => {
    expect(cspHeader({ 'default-src': ["'none'"] }, server))
      .toBe("default-src 'none'; connect-src 'self' wss://electrum.example:50004");
  });

  it('lets the configured policy run the simulator, the Lifecycle page and the Wallet tab', () => {
    const config = loadConfig();
    const header = cspHeader(config.deploy.contentSecurityPolicy, config.electrum.mainnet);
    // The simulator runs libauth's WebAssembly; the Lifecycle page and the Wallet tab open the configured Electrum
    // server, and the Wallet tab the WizardConnect relays.
    expect(header).toMatch(/script-src [^;]*'wasm-unsafe-eval'/);
    const connect = /connect-src ([^;]*)/.exec(header)?.[1]?.split(' ') ?? [];
    expect(connect).toContain("'self'");
    expect(connect).toContain(electrumOrigin(config.electrum.mainnet));
    for (const relay of config.walletTrade.relayUrls) expect(connect).toContain(new URL(relay).origin);
    expect(header).not.toContain("'unsafe-inline'");
    expect(header).toContain("frame-ancestors 'none'");
  });
});

describe('web server template', () => {
  it('fills every placeholder of the deploy template', () => {
    const template = readFileSync(new URL('../deploy/nginx.conf.tmpl', import.meta.url), 'utf8');
    const out = renderTemplate(template, { CSP: "default-src 'self'", ASSET_MAX_AGE: '60', MEDIA_MAX_AGE: '30' });
    expect(out).not.toMatch(/@[A-Z_]+@/);
    expect(out).toContain(`set $csp "default-src 'self'";`);
    expect(out).toContain('max-age=60, immutable');
    expect(out).toContain('max-age=30"');
  });

  it('rejects unknown placeholders and values that would break the config', () => {
    expect(() => renderTemplate('a @NOPE@ b', {})).toThrow('unknown placeholder @NOPE@');
    expect(() => renderTemplate('@CSP@', { CSP: 'x"; evil' })).toThrow('would break');
  });
});
