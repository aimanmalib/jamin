// Keeps the pool of public demo escrows full (decision 0021): counts the escrows still waiting at `paid`, and when
// there are fewer than pool.size, before pool.restageUntil and within pool.budgetSats, sweeps the demo keys' spare
// coins back to the project wallet and stages new escrows. Run by deploy/demo-restage-cron.sh on the host.
//   tsx scripts/demo-restage.ts --network mainnet [--kering]    (--kering: count and plan only, nothing is sent)
//   tsx scripts/demo-restage.ts --network regtest [--release-first]
//   tsx scripts/demo-restage.ts --network mock --release-first
// --release-first (test networks only) releases the first waiting escrow before the restage, as a visitor would.
// On mainnet the wallet pays through the spending gate and only through mainnet.broadcastHosts; this script never
// sends a mainnet release. Ledger: state/demo-pool.json (mainnet) or state/regtest/demo-pool.json; the site reads
// the list of pool escrows from state/demo-public/pool.json, served read-only at /pool/pool.json.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Network, type Artifact, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { hexToBin } from '@bitauth/libauth';
import { loadConfig, repoRoot } from '../src/config.js';
import { demoKeys, validDemoConfig, type DemoConfig } from '../src/demo/config.js';
import { attachDemo, demoStatus, releaseDemo, type DemoParties } from '../src/demo/escrow.js';
import { stageDemo, sweepDemoKeys, type StageTerms } from '../src/demo/stage.js';
import {
  emptyLedger, netSpent, poolIndex, readLedger, recordFailure, recordSuccess, restage, validPool,
  writeJsonAtomic, type PoolLedger, type RestageDeps,
} from '../src/demo/pool.js';
import { readRecord } from '../src/lifecycle/record.js';
import { mockNet, regtestNet, type Net } from './demo-nets.js';
import { mainnetNet, stagingNeed, type MainnetNet } from './demo-mainnet.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const network = arg('network') ?? '';
const flags = new Set(process.argv.slice(2));
const dry = flags.has('--kering') || flags.has('--dry');
const releaseFirst = flags.has('--release-first');

if (!['mock', 'regtest', 'mainnet'].includes(network)) {
  console.error('usage: tsx scripts/demo-restage.ts --network mock|regtest|mainnet [--kering] [--release-first]');
  process.exit(2);
}
if (network === 'mainnet' && releaseFirst) {
  console.error('refused: a mainnet demo escrow is released by a visitor, never by this script');
  process.exit(2);
}

const cfg = loadConfig();
const demo = validDemoConfig(JSON.parse(readFileSync(`${repoRoot}config/demo.json`, 'utf8')) as DemoConfig,
  BigInt(cfg.escrow.feeBps));
const pool = validPool(demo.pool);
const artifact = JSON.parse(readFileSync(`${repoRoot}artifacts/solidcash/JaminEscrow.json`, 'utf8')) as Artifact;
const terms: StageTerms = { feeBps: BigInt(cfg.escrow.feeBps), disputeFee: BigInt(cfg.escrow.disputeFeeSats),
  waitSeconds: BigInt(cfg.escrow.sellerWaitingTimeSeconds), reserve: BigInt(cfg.escrow.containerReserveSats),
  feeRate: cfg.mainnet.feeRateSatsPerByte };
const ledgerFile = network === 'mainnet' ? `${repoRoot}state/demo-pool.json`
  : network === 'regtest' ? `${repoRoot}state/regtest/demo-pool.json` : undefined;
const publicFile = `${repoRoot}state/demo-public/pool.json`;

/** One-time warnings go through NOTIFY_CMD (set by the cron script from deploy/hos.env); without it, to stderr. */
function notify(text: string): void {
  const cmd = process.env.NOTIFY_CMD;
  if (!cmd) { console.error(`warning: ${text}`); return; }
  spawnSync('sh', ['-c', `${cmd} "$1" warn`, 'sh', text], { stdio: 'inherit', timeout: 60_000 });
}

/** What the run reads with, and how it pays when it must stage. */
/** `payer(need)`: the wallet, refusing (FundsShort) when it holds less than `need` at the seller; the sweep asks 0. */
interface Side { read: NetworkProvider; parties: DemoParties; known: string[]; payer(need: bigint): Promise<Net>; close(): Promise<void> }

function partiesFor(prefix: Net['prefix']): DemoParties {
  return { keys: demoKeys(demo, prefix), feeRecipientPkh: hexToBin(cfg.walletTrade.feeRecipientPkh) };
}

async function mainnetSide(): Promise<Side> {
  const s = cfg.electrum.mainnet;
  const electrum = new ElectrumNetworkProvider(Network.MAINNET,
    { hostname: s.hostname, port: s.port, encrypted: s.scheme === 'wss', manualConnectionManagement: true });
  await electrum.connect();
  const known = readRecord(`${repoRoot}${cfg.mainnetExamples}`).escrows.filter((e) => e.demo === true && e.address)
    .map((e) => e.address as string);
  let wallet: MainnetNet | undefined;
  return {
    read: electrum as unknown as NetworkProvider, parties: partiesFor('bitcoincash'), known,
    // Opened only when a staging is due: it reads the wallet phrase and pays through the spending gate. The sweep
    // opens it with need 0, so a wallet too short to stage still gets the demo keys' spare coins back.
    payer: async (need) => {
      if (wallet && need > 0n) { await wallet.electrum.disconnect(); wallet = undefined; }
      wallet ??= await mainnetNet(cfg, repoRoot, need);
      return { provider: wallet.provider, prefix: 'bitcoincash', pay: wallet.pay, returnAddress: wallet.returnAddress,
        node: wallet.node };
    },
    close: async () => { await electrum.disconnect(); if (wallet) await wallet.electrum.disconnect(); },
  };
}

async function testSide(): Promise<Side> {
  const net = network === 'mock' ? await mockNet() : await regtestNet(cfg);
  return { read: net.provider, parties: partiesFor(net.prefix), known: [], payer: async () => net, close: async () => {} };
}

const side = network === 'mainnet' ? await mainnetSide() : await testSide();
const statusOf = async (a: string): Promise<Awaited<ReturnType<typeof demoStatus>>> =>
  demoStatus(await attachDemo(side.read, artifact, side.parties, a));

function deps(ledger: PoolLedger): RestageDeps {
  return {
    pool, ledger, now: new Date(), known: side.known, dry, notify, feeCoinsPerEscrow: demo.feeCoinSats.length,
    status: statusOf,
    sweepBack: async (keep) => {
      const net = await side.payer(0n);
      console.log(`  sweeping the demo keys' spare coins, keeping ${keep} at the seller`);
      const held = async (): Promise<bigint> => (await net.provider.getUtxos(net.returnAddress))
        .filter((u) => !u.token).reduce((a, u) => a + u.satoshis, 0n);
      const before = await held();
      const back = await sweepDemoKeys(net.provider, side.parties, keep, net.returnAddress, terms.feeRate);
      console.log(`  return address ${net.returnAddress}: ${before} sats before the sweep, ${await held()} after`);
      return back;
    },
    stage: async () => {
      const net = await side.payer(stagingNeed(demo));
      console.log(`  staging an escrow on ${net.node}`);
      return stageDemo(net.provider, artifact, demo, side.parties, terms, net.pay, net.returnAddress);
    },
  };
}

function report(label: string, r: Awaited<ReturnType<typeof restage>>): void {
  console.log(`${label}: ${r.ready.length} of ${pool.size} waiting at paid; plan stage ${r.plan.stage}`
    + `${r.plan.stop ? ` (stop: ${r.plan.stop})` : ''}${dry ? '; dry, nothing sent' : ''}`);
  if (r.swept) console.log(`  swept ${r.swept.sats} sats back: ${r.swept.txid}`);
  for (const e of r.ledger.escrows.filter((x) => r.staged.includes(x.address))) {
    console.log(`  staged ${e.address} for ${e.costSats} sats`);
    for (const s of e.steps) console.log(`    ${s.step} ${s.txid}`);
  }
  console.log(`  pool spent ${r.ledger.spentSats}, swept ${r.ledger.sweptSats}, net ${netSpent(r.ledger)} of ${pool.budgetSats}`);
}

let ledger = ledgerFile ? readLedger(ledgerFile) : emptyLedger();
let code = 0;
try {
  if (network === 'mock' && !dry) {
    // A new mock network starts empty: fill the pool first, so there is something to release.
    const r0 = await restage(deps(ledger));
    report('mock, first fill', r0);
    ledger = r0.ledger;
  }
  if (releaseFirst) {
    const first = await restage({ ...deps(ledger), dry: true });
    const target = first.ready[0];
    if (target === undefined) throw new Error('--release-first: no escrow is waiting');
    const sent = await releaseDemo(side.read, artifact, side.parties, target, false);
    console.log(`test release of ${target}: ${sent.txid}; status ${await statusOf(target)}`);
  }
  const r = await restage(deps(ledger));
  report(network, r);
  ledger = r.ledger;
  if (r.waitingFunds) console.log(`  waiting for funds: ${r.waitingFunds}`);
  if (r.failed) console.error(`restage failed: ${r.failed}`);
  if (!dry) {
    // Waiting for funds is not a failure: the count of failed runs stays as it is and no warning goes out.
    if (r.failed) { ledger = recordFailure(ledger, r.failed, new Date(), notify); code = 1; }
    else if (!r.waitingFunds) ledger = recordSuccess(ledger);
    if (ledgerFile) writeJsonAtomic(ledgerFile, ledger);
    if (network === 'mainnet') {
      writeJsonAtomic(publicFile, poolIndex(pool, side.known, ledger, new Date(), r.waitingFunds !== undefined));
    }
  }
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`restage failed: ${msg}`);
  if (!dry && ledgerFile) writeJsonAtomic(ledgerFile, recordFailure(ledger, msg, new Date(), notify));
  code = 1;
} finally {
  await side.close();
}
process.exit(code);
