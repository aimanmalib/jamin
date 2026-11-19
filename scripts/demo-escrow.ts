// Stages the public demo escrow (createEscrow, fund, markAsPaid with the demo keys of config/demo.json) and, on a
// test network, releases it with the same module the browser card uses (src/demo/escrow.ts): first dry, then sent.
//   npx tsx scripts/demo-escrow.ts --network mock --stage --release
//   npx tsx scripts/demo-escrow.ts --network regtest --stage --release    (needs bash scripts/regtest-node.sh start)
// Mainnet staging is a separate step (row DM2 of the plan); this version refuses it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RegtestNetworkProvider, type Artifact, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { loadConfig, repoRoot } from '../src/config.js';
import { demoKeys, validDemoConfig, type DemoConfig, type Prefix } from '../src/demo/config.js';
import { demoStatus, attachDemo, releaseDemo, type DemoParties } from '../src/demo/escrow.js';
import { stageDemo, type Pay } from '../src/demo/stage.js';
import { regtestRpc } from '../src/lifecycle/regtest.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const network = arg('network') ?? '';
const flags = new Set(process.argv.slice(2));

const cfg = loadConfig();
const demo = validDemoConfig(JSON.parse(readFileSync(`${repoRoot}config/demo.json`, 'utf8')) as DemoConfig,
  BigInt(cfg.escrow.feeBps));
const artifact = JSON.parse(readFileSync(`${repoRoot}artifacts/solidcash/JaminEscrow.json`, 'utf8')) as Artifact;

interface Net { provider: NetworkProvider; prefix: Prefix; pay: Pay; returnAddress: string; node: string }

function randomTxid(): string {
  return binToHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function mockNet(): Promise<Net> {
  const mock = new MockNetworkProvider({ profile: 'production' });
  const [wallet] = await mock.getSigners(1);
  if (!wallet) throw new Error('mock signer missing');
  const pay: Pay = async (address, amounts) => {
    const txid = randomTxid();
    return Promise.all(amounts.map((satoshis, vout) => mock.seedUtxo(address, { txid, vout, satoshis })));
  };
  return { provider: mock as unknown as NetworkProvider, prefix: 'bchtest', pay, returnAddress: wallet.address,
    node: 'SolidCash MockNetworkProvider (production profile)' };
}

async function regtestNet(): Promise<Net> {
  const rpcUrl = `http://127.0.0.1:${cfg.regtest.rpcPort}`;
  const user = process.env.REGTEST_RPC_USER ?? 'user';
  const password = process.env.REGTEST_RPC_PASSWORD ?? 'password';
  const regtest = new RegtestNetworkProvider({ rpcUrl, rpcUser: user, rpcPassword: password });
  const rpc = regtestRpc(rpcUrl, user, password);
  const zero = '00'.repeat(32);
  const pay: Pay = async (address, amounts) => {
    const out: Utxo[] = [];
    for (const satoshis of amounts) out.push(await regtest.addUtxo(address, { txid: zero, vout: 0, satoshis }));
    return out;
  };
  const node = (await rpc('getnetworkinfo') as { subversion: string }).subversion;
  return { provider: regtest as unknown as NetworkProvider, prefix: 'bchreg', pay,
    returnAddress: await rpc('getnewaddress') as string, node };
}

if (network === 'mainnet') {
  console.error('mainnet staging is not in this version (row DM2); use --network mock or regtest');
  process.exit(2);
}
if ((network !== 'mock' && network !== 'regtest') || !flags.has('--stage')) {
  console.error('usage: tsx scripts/demo-escrow.ts --network mock|regtest --stage [--release]');
  process.exit(2);
}

const net = network === 'mock' ? await mockNet() : await regtestNet();
const parties: DemoParties = { keys: demoKeys(demo, net.prefix), feeRecipientPkh: hexToBin(cfg.walletTrade.feeRecipientPkh) };
const terms = { feeBps: BigInt(cfg.escrow.feeBps), disputeFee: BigInt(cfg.escrow.disputeFeeSats),
  waitSeconds: BigInt(cfg.escrow.sellerWaitingTimeSeconds), reserve: BigInt(cfg.escrow.containerReserveSats),
  feeRate: cfg.mainnet.feeRateSatsPerByte };
const staged = await stageDemo(net.provider, artifact, demo, parties, terms, net.pay, net.returnAddress);
const status = await demoStatus(await attachDemo(net.provider, artifact, parties, staged.address));
console.log(`staged ${staged.address} on ${net.node}: status ${status}, demo keys can spend ${staged.exposure} sats`);
for (const s of staged.steps) console.log(`  ${s.step} ${s.txid}`);

const result: Record<string, unknown> = { network, node: net.node, measuredAt: new Date().toISOString(),
  address: staged.address, statusAfterStaging: status, exposureSats: Number(staged.exposure), maxSats: demo.maxSats,
  steps: staged.steps, extra: staged.extra };
if (flags.has('--release')) {
  const dry = await releaseDemo(net.provider, artifact, parties, staged.address, true);
  const after = await demoStatus(await attachDemo(net.provider, artifact, parties, staged.address));
  console.log(`dry release: txid ${dry.txid}, ${dry.bytes} bytes, not sent; status still ${after}`);
  const sent = await releaseDemo(net.provider, artifact, parties, staged.address, false);
  const end = await demoStatus(await attachDemo(net.provider, artifact, parties, staged.address));
  console.log(`release: txid ${sent.txid}, ${sent.bytes} bytes; status ${end}; dry txid ${dry.txid === sent.txid ? 'equal' : 'differs'}`);
  result.dryRelease = { ...dry, statusAfter: after };
  result.release = { ...sent, statusAfter: end };
}
const dir = `${repoRoot}state/demo`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/${network}.json`, `${JSON.stringify(result, null, 2)}\n`);
