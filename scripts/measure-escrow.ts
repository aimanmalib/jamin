// Script sizes of the escrow contracts (docs/MEASURED.md, "Escrow contract sizes").
// Runs every lifecycle step once on a mock network with the production profile and prints, per step, the
// transaction size and the largest unlocking script. Needs compiled artifacts: run `npx solidhat compile` first.
// Usage: npx tsx scripts/measure-escrow.ts
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { utils } from '@solidcash/solidcash';
import {
  RESERVE_SATS, TERMS, deploy, entry, loadArtifact, lockOf, lockTimeNow, roleParams, world, type World,
} from '../test/helpers/escrow.js';

const MAX_INPUT_BYTES = 10_000;
const FEE = 600n;
const rows: string[] = [];

async function record(w: World, contract: string, step: string, txid: string): Promise<void> {
  const tx = decodeTransaction(hexToBin(await w.provider.getRawTransaction(txid)));
  if (typeof tx === 'string') throw new Error(tx);
  const sizes = tx.inputs.map((i) => i.unlockingBytecode.length);
  const bytes = (await w.provider.getRawTransaction(txid)).length / 2;
  rows.push(`| ${contract} | ${step} | ${bytes.toLocaleString('en')} | ${sizes.length} | ` +
    `${Math.max(...sizes).toLocaleString('en')} / ${MAX_INPUT_BYTES.toLocaleString('en')} |`);
}

type Send = () => Promise<{ txid: string }>;

async function run(w: World, contract: string, steps: Array<[string, Send]>): Promise<void> {
  for (const [step, send] of steps) await record(w, contract, step, (await send()).txid);
}

async function bch(path: 'release' | 'buyerCancel' | 'sellerCancel' | 'dispute'): Promise<void> {
  const w = await world();
  const { seller, buyer, arbitrator } = w.roles;
  const d = await deploy(w, 'JaminEscrow', roleParams(w.roles), [TERMS.amount, TERMS.feeBps, TERMS.disputeFee,
    w.cancelAfter]);
  const as = (s: typeof seller): typeof d.sc => d.sc.connect(s);
  const steps: Array<[string, Send]> = [['fund', () => entry(as(seller), 'fund', w.sig(seller))
    .withValue(TERMS.amount + FEE).send()]];
  if (path === 'release') {
    steps.push(['markAsPaid', () => entry(as(buyer), 'markAsPaid', w.sig(buyer)).send()]);
    steps.push(['release', () => entry(as(seller), 'release', w.sig(seller)).send()]);
  } else if (path === 'buyerCancel') {
    steps.push(['buyerCancel', () => entry(as(buyer), 'buyerCancel', w.sig(buyer)).send()]);
  } else if (path === 'sellerCancel') {
    w.provider.increaseTime(TERMS.waitSeconds + 60n);
    await w.provider.mine(1);
    steps.push(['sellerCancel', async () => entry(as(seller), 'sellerCancel', w.sig(seller))
      .setLocktime(await lockTimeNow(w)).transfer(lockOf(seller.address), TERMS.amount + FEE).send()]);
  } else {
    steps.push(['markAsPaid', () => entry(as(buyer), 'markAsPaid', w.sig(buyer)).send()]);
    steps.push(['openDispute', () => entry(as(buyer), 'openDispute', w.sig(buyer), true)
      .withValue(TERMS.disputeFee).send()]);
    steps.push(['resolveDispute', () => entry(as(arbitrator), 'resolveDispute', w.sig(arbitrator), true).send()]);
  }
  await record(w, 'JaminEscrow', `deploy (reserve ${RESERVE_SATS} sats)`, d.txid);
  await run(w, 'JaminEscrow', steps);
}

async function token(): Promise<void> {
  const w = await world();
  const { seller, buyer, arbitrator } = w.roles;
  const amount = 200n; const fee = 1n; const reserve = 1n;
  const { categoryId, utxos } = await w.provider.addTokenUtxos([
    { address: seller.address, satoshis: 1_000n, token: { amount: amount + fee + reserve } },
  ]);
  const coin = utxos[0];
  if (!coin) throw new Error('token coin missing');
  const d = await deploy(w, 'JaminTokenEscrow', [...roleParams(w.roles), categoryId],
    [amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
  await record(w, 'JaminTokenEscrow', 'deploy', d.txid);
  const as = (s: typeof seller): typeof d.sc => d.sc.connect(s);
  await run(w, 'JaminTokenEscrow', [
    ['deposit', () => entry(as(seller), 'deposit', w.sig(seller), categoryId).addInput(coin, seller.unlockP2PKH())
      .tokenContainerDeposit(categoryId, amount + fee + reserve).send()],
    ['markAsPaid', () => entry(as(buyer), 'markAsPaid', w.sig(buyer), categoryId).send()],
    ['openDispute', () => entry(as(buyer), 'openDispute', w.sig(buyer), true).withValue(TERMS.disputeFee).send()],
    ['resolveDispute', () => entry(as(arbitrator), 'resolveDispute', w.sig(arbitrator), categoryId, true).send()],
  ]);
}

console.log('| Artifact | Redeem script bytes | ABI entries |');
console.log('|---|---|---|');
for (const name of ['JaminEscrow', 'JaminTokenEscrow']) {
  const a = loadArtifact(name);
  console.log(`| ${name} | ${utils.calculateBytesize(utils.asmToScript(a.bytecode)).toLocaleString('en')} | ` +
    `${a.abi.length} |`);
}
for (const path of ['release', 'buyerCancel', 'sellerCancel', 'dispute'] as const) await bch(path);
await token();
console.log('');
console.log('| Contract | Step | Tx bytes | Inputs | Largest unlocking script |');
console.log('|---|---|---|---|---|');
const seen = new Set<string>();
for (const r of rows) {
  const key = r.split('|').slice(1, 3).join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(r);
}
