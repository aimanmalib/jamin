// Contract-shape spike (docs/decisions/0002-contract-shape.md).
// Compiles each candidate escrow shape, then runs its lifecycle on a mock network with the production
// profile (BCH size limits, dust, standard relay VM) and prints the size of every unlocking script.
// Usage: npx tsx scripts/measure-shapes.ts [--json]
import { compileFileMulti } from '@solidcash/solidc';
import { Contract, SignatureTemplate, TransactionBuilder, randomUtxo, utils, type Artifact } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { asProvider, entry } from '../src/sdk/mock.js';
import { decodeTransaction, hexToBin } from '@bitauth/libauth';

const DIR = 'test/fixtures/shapes';
const MAX_INPUT_BYTES = 10_000;

export interface Row {
  shape: string;
  mode: string;
  step: string;
  ok: boolean;
  txBytes?: number;
  inputs?: number;
  maxUnlockingBytes?: number;
  note?: string | undefined;
}

const rows: Row[] = [];

function compile(file: string, evmCompat: boolean, composition?: 'framed'): Record<string, Artifact> {
  const options = composition ? { evmCompat, composition } : { evmCompat };
  return compileFileMulti(`${DIR}/${file}`, options as never) as unknown as Record<string, Artifact>;
}

interface SizeRow { shape: string; mode: string; composition: string; artifacts: string; ms: number; note?: string | undefined }
const sizeRows: SizeRow[] = [];

function measureCompile(shape: string, file: string, evmCompat: boolean, composition?: 'framed'): void {
  const mode = evmCompat ? 'evmCompat' : 'native';
  const started = Date.now();
  try {
    const map = compile(file, evmCompat, composition);
    const sizes = Object.entries(map).map(([name, a]) =>
      `${name} ${utils.calculateBytesize(utils.asmToScript(a.bytecode))} B, ${a.abi.length} entries`);
    sizeRows.push({ shape, mode, composition: composition ?? 'direct', artifacts: sizes.join('; '),
      ms: Date.now() - started });
  } catch (e) {
    const note = String(e instanceof Error ? e.message : e).split('\n')[0]?.slice(0, 300);
    sizeRows.push({ shape, mode, composition: composition ?? 'direct', artifacts: '', ms: Date.now() - started, note });
  }
}

async function record(shape: string, mode: string, step: string, provider: MockNetworkProvider, txid: string):
  Promise<void> {
  const hex = await provider.getRawTransaction(txid);
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(tx);
  const sizes = tx.inputs.map((i) => i.unlockingBytecode.length);
  rows.push({ shape, mode, step, ok: true, txBytes: hex.length / 2, inputs: sizes.length,
    maxUnlockingBytes: Math.max(...sizes) });
}

function fail(shape: string, mode: string, step: string, error: unknown): void {
  const note = String(error instanceof Error ? error.message : error).split('\n')[0]?.slice(0, 400);
  rows.push({ shape, mode, step, ok: false, note });
}

function newProvider(): MockNetworkProvider {
  if (process.env.MEASURE_RELAXED === '1') return new MockNetworkProvider();
  return new MockNetworkProvider({ profile: 'production' });
}

async function covenant(): Promise<void> {
  const shape = 'A covenant (.scash)';
  const art = compile('CovenantEscrow.scash', false).CovenantEscrow as Artifact;
  for (const step of ['release', 'buyerCancel'] as const) {
    const provider = newProvider();
    const [seller, buyer, fees] = await provider.getSigners(3);
    if (!seller || !buyer || !fees) throw new Error('signers');
    const amount = 200_000n; const fee = 600n; const minerFee = 1_000n;
    const ctor = [seller.publicKey, buyer.publicKey, fees.pkh, amount, fee,
      minerFee];
    const contract = new Contract(art, ctor, { provider: asProvider(provider) });
    try {
      const utxo = await provider.seedUtxo(contract.address, randomUtxo({ satoshis: amount + fee + minerFee }));
      const b = new TransactionBuilder({ provider: asProvider(provider) });
      const unlock = contract.unlock[step];
      if (unlock === undefined) throw new Error(`no entry point ${step}`);
      if (step === 'release') {
        b.addInput(utxo, unlock(new SignatureTemplate(seller.privateKey)))
          .addOutput({ to: buyer.address, amount }).addOutput({ to: fees.address, amount: fee });
      } else {
        b.addInput(utxo, unlock(new SignatureTemplate(buyer.privateKey)))
          .addOutput({ to: seller.address, amount: amount + fee });
      }
      const sent = await b.send();
      await record(shape, 'native', step, provider, sent.txid);
    } catch (e) { fail(shape, 'native', step, e); }
  }
}

async function stateful(shape: string, file: string, name: string, evmCompat: boolean,
  run: (sc: StatefulContract, keys: { seller: SignatureTemplate; buyer: SignatureTemplate }, step: string,
    ctx: { buyer: string; amount: bigint }) => Promise<string>): Promise<void> {
  const mode = evmCompat ? 'evmCompat' : 'native';
  let art: Artifact;
  try { art = compile(file, evmCompat)[name] as Artifact; } catch (e) { fail(shape, mode, 'compile', e); return; }
  for (const step of ['release', 'buyerCancel'] as const) {
    const provider = newProvider();
    const [seller, buyer, fees] = await provider.getSigners(3);
    if (!seller || !buyer || !fees) throw new Error('signers');
    const amount = 200_000n; const fee = 600n;
    const params = !art.constructorInputs.some((i) => i.name === 'seller') ? []
      : [seller.publicKey, buyer.publicKey, fees.pkh];
    let sc: StatefulContract;
    try {
      const utxos = await provider.getUtxos(seller.address);
      const fundingUtxo = utxos.find((u) => u.vout === 0 && !u.token);
      if (!fundingUtxo) throw new Error('no vout 0 funding coin');
      const initArgs = name === 'StatefulEscrow' ? [amount, fee] : undefined;
      const deployed = await StatefulContract.deploy(art, params, { provider: asProvider(provider), fundingUtxo,
        funder: seller.unlockP2PKH(), changeAddress: seller.address,
        initialBalance: name === 'StatefulEscrow' ? amount + fee : 0n, ...(initArgs ? { initArgs } : {}) });
      sc = deployed.contract.connect(seller);
      await record(shape, mode, `deploy (${step} run)`, provider, deployed.tx.txid);
    } catch (e) { fail(shape, mode, 'deploy', e); continue; }
    try {
      const keys = { seller: new SignatureTemplate(seller.privateKey), buyer: new SignatureTemplate(buyer.privateKey) };
      const txid = await run(sc, keys, step, { buyer: buyer.address, amount });
      await record(shape, mode, step, provider, txid);
    } catch (e) { fail(shape, mode, step, e); }
  }
}

async function main(): Promise<void> {
  measureCompile('A covenant (.scash)', 'CovenantEscrow.scash', false);
  measureCompile('B stateful (.scash)', 'StatefulEscrow.scash', false);
  measureCompile('B stateful (.scash)', 'StatefulEscrow.scash', true);
  measureCompile('B stateful (.scash)', 'StatefulEscrow.scash', false, 'framed');
  measureCompile('B full entry set (.scash)', 'StatefulEscrowFull.scash', false);
  measureCompile('C mapping port (.sol)', 'OpenPeerShape.sol', true);
  measureCompile('C mapping port (.sol)', 'OpenPeerShape.sol', true, 'framed');
  await covenant();
  await stateful('B stateful (.scash)', 'StatefulEscrow.scash', 'StatefulEscrow', false, async (sc, k, step) => {
    const call = step === 'release' ? entry(sc, 'release', k.seller) : entry(sc, 'buyerCancel', k.buyer);
    return (await call.send()).txid;
  });
  await stateful('C mapping port (.sol)', 'OpenPeerShape.sol', 'OpenPeerShape', true, async (sc, _k, step, c) => {
    const order = '11'.repeat(32);
    const value = c.amount + (c.amount * 30n) / 10_000n;
    try { await entry(sc, 'createNativeEscrow', order, c.buyer, c.amount, 900n).withValue(value).send(); }
    catch (e) { throw new Error(`createNativeEscrow: ${String((e as Error).message)}`); }
    const call = step === 'release' ? entry(sc, 'release', order, c.buyer, c.amount)
      : entry(sc, 'buyerCancel', order, c.buyer, c.amount);
    return (await call.send()).txid;
  });
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ sizeRows, rows }, null, 2)); return; }
  console.log('| Shape | Mode | Composition | Artifacts (redeem script bytes, ABI entries) | Compile ms |');
  console.log('|---|---|---|---|---|');
  for (const r of sizeRows) {
    console.log(`| ${r.shape} | ${r.mode} | ${r.composition} | ${r.note ? `failed: ${r.note}` : r.artifacts} | ${r.ms} |`);
  }
  console.log('');
  console.log('| Shape | Mode | Step | Result | Tx bytes | Inputs | Largest unlocking script (bytes) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const size = r.maxUnlockingBytes === undefined ? '' : `${r.maxUnlockingBytes} / ${MAX_INPUT_BYTES}`;
    console.log(`| ${r.shape} | ${r.mode} | ${r.step} | ${r.ok ? 'ok' : `failed: ${r.note ?? ''}`} | ` +
      `${r.txBytes ?? ''} | ${r.inputs ?? ''} | ${size} |`);
  }
}

await main();
