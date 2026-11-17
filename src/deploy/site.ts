import type { ElectrumServer } from '../config.js';

/** Directive name to sources, in the order they are sent. */
export type CspDirectives = Record<string, string[]>;

/** The origin the browser opens for an Electrum server, e.g. `wss://bch.imaginary.cash:50004`. */
export function electrumOrigin(server: ElectrumServer): string {
  return `${server.scheme}://${server.hostname}:${server.port}`;
}

/**
 * Content-Security-Policy header value. The configured directives are sent as they are, with the mainnet
 * Electrum origin added to connect-src: the Lifecycle page reads balances from it straight from the browser.
 */
export function cspHeader(policy: CspDirectives, electrum: ElectrumServer): string {
  const directives: CspDirectives = { ...policy };
  const connect = directives['connect-src'] ?? ["'self'"];
  const origin = electrumOrigin(electrum);
  directives['connect-src'] = connect.includes(origin) ? connect : [...connect, origin];
  return Object.entries(directives).map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/** Fills the @...@ placeholders of the web server template. Every placeholder must be known. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const out = template.replace(/@([A-Z_]+)@/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`unknown placeholder ${match}`);
    if (/["\n\\]/.test(value)) throw new Error(`value for ${match} would break the web server config`);
    return value;
  });
  return out;
}
