import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/FEATURES.md names code by `file:line` and tests by their titles. Code moves, so this test pins what each
// reference must point at; a moved line or a renamed test turns it red instead of leaving the table quietly wrong.
const PINS: Record<string, RegExp> = {
  'contracts/EscrowBase.scash:3': /import "\.\/FeeMath\.scash"/,
  'contracts/EscrowBase.scash:9': /abstract contract EscrowBase\(/,
  'contracts/EscrowBase.scash:11': /enum Status/,
  'contracts/EscrowBase.scash:13': /struct Terms/,
  'contracts/EscrowBase.scash:23': /Status public status/,
  'contracts/EscrowBase.scash:31': /event Released/,
  'contracts/EscrowBase.scash:40': /error NotSeller/,
  'contracts/EscrowBase.scash:55': /modifier onlySeller\(sig/,
  'contracts/EscrowBase.scash:56': /checkSig\(s, seller\)/,
  'contracts/EscrowBase.scash:66': /modifier onlyPanel\(sig first, sig second\)/,
  'contracts/EscrowBase.scash:75': /^\s*}\s*$/,
  'contracts/EscrowBase.scash:85': /this\.terms = Terms\(/,
  'contracts/EscrowBase.scash:107': /msg\.value == this\.terms\.disputeFee/,
  'contracts/EscrowBase.scash:122': /internal view/,
  'contracts/FeeMath.scash:4': /library FeeMath/,
  'contracts/FeeMath.scash:5': /constant/,
  'contracts/JaminEscrow.scash:4': /pragma satoshicontainer single/,
  'contracts/JaminEscrow.scash:6': /import "\.\/EscrowBase\.scash"/,
  'contracts/JaminEscrow.scash:9': /contract JaminEscrow\(/,
  'contracts/JaminEscrow.scash:13': /constant DUST_LIMIT/,
  'contracts/JaminEscrow.scash:15': /constructor\(/,
  'contracts/JaminEscrow.scash:16': /FeeMath\.tradeFee\(/,
  'contracts/JaminEscrow.scash:20': /function fund\(.*payable/,
  'contracts/JaminEscrow.scash:33': /this\.transfer\(new LockingBytecodeP2PKH/,
  'contracts/JaminEscrow.scash:35': /emit Released/,
  'contracts/JaminEscrow.scash:48': /tx\.time >=/,
  'contracts/JaminEscrow.scash:61': /function resolveDispute\(.*onlyPanel/,
  'contracts/JaminEscrow.scash:80': /if \(buyerWins\)/,
  'contracts/JaminTokenEscrow.scash:10': /contract JaminTokenEscrow\(/,
  'contracts/JaminTokenEscrow.scash:14': /constant RESERVE_UNITS/,
  'contracts/JaminTokenEscrow.scash:19': /modifier onlyToken\(/,
  'contracts/JaminTokenEscrow.scash:32': /this\.outState\.tokens\[category\]/,
  'contracts/JaminTokenEscrow.scash:43': /this\.tokens\[category\]\.transfer\(/,
  'contracts/JaminTokenEscrow.scash:56': /tx\.time >=/,
  'contracts/JaminTokenEscrow.scash:68': /function resolveDispute\(/,
  'src/lifecycle/branches.ts:37': /StatefulContract\.deploy\(/,
  'src/lifecycle/context.ts:86': /SignatureAlgorithm\.ECDSA/,
  'src/lifecycle/context.ts:104': /contract\.connect\(/,
  'src/lifecycle/wallet-branch.ts:35': /Signer\.external\(/,
  'src/lifecycle/mainnet.ts:54': /new TransactionBuilder\(.*unlockP2PKH\(\)/,
  'test/helpers/escrow.ts:48': /new MockNetworkProvider\(\{ profile: 'production' \}\)/,
};

const rows = readFileSync('docs/FEATURES.md', 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()));

/** Every `file:line` in the Where column; a bare `:n` continues the file before it. */
function references(where: string): string[] {
  let file = '';
  return [...where.matchAll(/`([\w./-]*):(\d+)`/g)].map(([, f, n]) => `${(file = f || file)}:${n}`);
}

/** Every `it(...)` title in the test folders; `${...}` in a template title stands for any text. */
function titles(): RegExp[] {
  const files = ['test', 'tests'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => join(d, f)));
  return files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bit\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)])
    .map(([, , raw = '']) => raw.replace(/\\(.)/g, '$1').split(/\$\{[^}]*\}/)
      .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+'))
    .map((source) => new RegExp(source));
}

describe('docs/FEATURES.md', () => {
  it('numbers its rows 1 to n without gaps', () => {
    expect(rows.map((r) => Number(r[1]))).toEqual(rows.map((_, i) => i + 1));
  });

  it('points every file:line at the code it names', () => {
    const named = rows.flatMap((r) => references(r[3] ?? ''));
    expect(named.length).toBeGreaterThan(0);
    for (const ref of named) {
      const pin = PINS[ref];
      expect(pin, `${ref} has no pin in this test`).toBeDefined();
      const [file, line] = ref.split(':') as [string, string];
      const text = readFileSync(file, 'utf8').split('\n')[Number(line) - 1] ?? '';
      expect(text, ref).toMatch(pin as RegExp);
    }
  });

  it('names only tests that exist', () => {
    const all = titles();
    const quoted = rows.flatMap((r) => [...(r[4] ?? '').matchAll(/"([^"]+)"/g)].map(([, q]) => q as string))
      .flatMap((q) => q.split('...').map((p) => p.trim()).filter(Boolean));
    expect(quoted.length).toBeGreaterThan(0);
    for (const fragment of quoted) {
      const found = all.some((title) => title.test(fragment) || title.source.includes(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      expect(found, fragment).toBe(true);
    }
  });
});
