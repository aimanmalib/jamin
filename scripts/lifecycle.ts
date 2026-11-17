// Runs the five escrow lifecycle branches on a real network and writes every transaction with its sizes.
//   npx tsx scripts/lifecycle.ts --network regtest [--branches A,B,C,D,E]
//   npx tsx scripts/lifecycle.ts --network mainnet [--branches A,B,C,D,E]   (test wallet, spending gate; see below)
// Regtest needs a node: bash scripts/regtest-node.sh start (and stop afterwards). Mainnet: scripts/lifecycle-mainnet.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, repoRoot } from '../src/config.js';
import { branchA, branchB, branchC, branchE, finishD, startD } from '../src/lifecycle/branches.js';
import type { Ctx, Terms } from '../src/lifecycle/context.js';
import { measure } from '../src/lifecycle/inspect.js';
import { regtestContext } from '../src/lifecycle/regtest.js';
import { mainnetRun } from './lifecycle-mainnet.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

const network = arg('network', '');
const wanted = new Set(arg('branches', 'A,B,C,D,E').split(','));
if (network === 'mainnet') process.exit(await mainnetRun([...wanted]));
if (network !== 'regtest') {
  console.error('usage: tsx scripts/lifecycle.ts --network regtest|mainnet [--branches A,B,C,D,E]');
  process.exit(2);
}

const cfg = loadConfig();
const terms: Terms = {
  amount: BigInt(cfg.mainnet.escrowAmountSats), tokenAmount: BigInt(cfg.regtest.tokenAmount),
  feeBps: BigInt(cfg.escrow.feeBps), disputeFee: BigInt(cfg.escrow.disputeFeeSats),
  waitSeconds: BigInt(cfg.escrow.sellerWaitingTimeSeconds), reserve: BigInt(cfg.escrow.containerReserveSats),
};

const { ctx, steps, rpc } = await regtestContext(terms);
const node = await rpc('getnetworkinfo') as { subversion: string };
const runs: Array<[string, (c: Ctx) => Promise<void>]> = [
  ['A', branchA], ['B', branchB], ['C', branchC],
  ['D', async (c) => finishD(c, await startD(c))], ['E', branchE],
];
const failures: string[] = [];
for (const [name, body] of runs) {
  if (!wanted.has(name)) continue;
  try {
    await body(ctx);
    console.log(`branch ${name}: ok`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`branch ${name}: FAILED ${(e as Error).message.slice(0, 400)}`);
  }
}

const measured = [];
for (const s of steps) {
  const m = await measure(ctx.provider, s);
  const tx = await rpc('getrawtransaction', [s.txid, true]) as { blockhash?: string };
  const height = tx.blockhash ? (await rpc('getblockheader', [tx.blockhash]) as { height: number }).height : null;
  measured.push({ ...m, height });
  console.log(`${s.branch} ${s.step.padEnd(14)} ${s.txid} tx ${m.txBytes} B, unlock max ${m.maxUnlockingBytes} B`);
}
const out = { network, node: node.subversion, at: new Date().toISOString(), terms: Object.fromEntries(
  Object.entries(terms).map(([k, v]) => [k, v.toString()])), failures, steps: measured };
const dir = `${repoRoot}${cfg.regtest.outputDir}`;
mkdirSync(dir, { recursive: true });
const file = `${dir}/run-${out.at.replace(/[:.]/g, '-')}.json`;
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`node ${node.subversion}; ${measured.length} transactions; written ${file.slice(repoRoot.length)}`);
process.exit(failures.length === 0 ? 0 : 1);
