// The numbers of the Home depth strip (decision 0026). Each is counted by a pure function from a file in the
// repository that the build imports, so the page cannot show a number the files do not hold:
// docs/FEATURES.md rows, artifacts/solidhat-tests.json cases, docs/SOLIDCASH-FINDINGS.md `## F<n>` headings,
// config depth.upstreamPrs and examples/mainnet.json (scenarios and transactions; demo pool escrows left out).
import { parseFeatures } from './features.js';
import type { MainnetRun } from './examples.js';

export interface Depth {
  /** Rows of the feature table in docs/FEATURES.md. */
  features: number;
  /** SolidHat test cases `npm run solidhat:test` runs. */
  tests: number;
  /** Findings headed `## F<n>` in docs/SOLIDCASH-FINDINGS.md. */
  findings: number;
  /** Pull requests this project opened upstream. */
  upstreamPrs: number;
  /** Labelled mainnet runs that are not demo pool escrows. */
  scenarios: number;
  /** Distinct transaction ids those runs record. */
  transactions: number;
}

export interface DepthSources {
  featuresMd: string;
  testCases: readonly unknown[];
  findingsMd: string;
  upstreamPrs: readonly number[];
  run: MainnetRun;
}

/** Headings `## F<n>` (one per finding), each number once. */
export function countFindings(markdown: string): number {
  return new Set([...markdown.matchAll(/^## F(\d+)\b/gm)].map((m) => m[1])).size;
}

/** Every string under a `txid` key, at any depth. */
export function txidsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) txidsIn(v, into);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'txid' && typeof v === 'string') into.add(v);
      else txidsIn(v, into);
    }
  }
  return into;
}

/** Scenarios (distinct branch labels) and their distinct transactions, demo pool escrows left out. */
export function mainnetDepth(run: MainnetRun): Pick<Depth, 'scenarios' | 'transactions'> {
  const runs = run.escrows.filter((e) => e.demo !== true);
  return { scenarios: new Set(runs.map((e) => e.branch)).size, transactions: txidsIn(runs).size };
}

export function depth(s: DepthSources): Depth {
  return {
    features: parseFeatures(s.featuresMd).length,
    tests: s.testCases.length,
    findings: countFindings(s.findingsMd),
    upstreamPrs: new Set(s.upstreamPrs).size,
    ...mainnetDepth(s.run),
  };
}
