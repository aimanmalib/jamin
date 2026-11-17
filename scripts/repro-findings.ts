// Minimal reproductions for docs/SOLIDCASH-FINDINGS.md. Each case prints what happened; nothing is broadcast.
// Usage: npx tsx scripts/repro-findings.ts
import { compileFileMulti } from '@solidcash/solidc';
import { SignatureTemplate, type Artifact } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { asProvider, entry } from '../src/sdk/mock.js';

const DIR = 'test/fixtures/findings';

function artifact(name: string, options: Record<string, unknown> = {}): Artifact {
  const map = compileFileMulti(`${DIR}/${name}.scash`, { evmCompat: false, ...options } as never);
  return (map as unknown as Record<string, Artifact>)[name] as Artifact;
}

function firstLine(error: unknown): string {
  const line = String(error instanceof Error ? error.message : error).split('\n')[0] ?? '';
  return line.split(' (stack:')[0]?.slice(0, 240) ?? '';
}

async function deploy(art: Artifact, args: unknown[], balance: bigint, extra: Record<string, unknown> = {}) {
  const provider = new MockNetworkProvider({ profile: 'production' });
  const [owner, a, b] = await provider.getSigners(3);
  if (!owner || !a || !b) throw new Error('signers');
  const fundingUtxo = (await provider.getUtxos(owner.address)).find((u) => u.vout === 0 && !u.token);
  if (!fundingUtxo) throw new Error('no vout 0 funding coin');
  const ctor = args.length > 0 ? [owner.publicKey, a.pkh, b.pkh] : [owner.publicKey];
  const { contract } = await StatefulContract.deploy(art, ctor, { provider: asProvider(provider), fundingUtxo, funder: owner.unlockP2PKH(),
    changeAddress: owner.address, initialBalance: balance, ...extra });
  return { sc: contract.connect(owner), key: new SignatureTemplate(owner.privateKey) };
}

async function framedLockingBytecode(): Promise<void> {
  for (const composition of ['direct', 'framed']) {
    try {
      artifact('FramedLockingBytecode', { composition });
      console.log(`F1 framed LockingBytecodeP2PKH, ${composition}: compiles`);
    } catch (e) { console.log(`F1 framed LockingBytecodeP2PKH, ${composition}: ${firstLine(e)}`); }
  }
}

async function transferOrder(): Promise<void> {
  const art = artifact('TransferOrder');
  for (const [x, y] of [[1_000n, 2_000n], [2_000n, 1_000n]] as const) {
    try {
      const { sc, key } = await deploy(art, ['pair'], 3_000n, { initialState: { n: 0n } });
      await entry(sc, 'pay', key, x, y).send();
      console.log(`F2 drain 3000 sats as ${x} then ${y}: sent`);
    } catch (e) { console.log(`F2 drain 3000 sats as ${x} then ${y}: ${firstLine(e)}`); }
  }
}

async function constructorValue(): Promise<void> {
  const art = artifact('ConstructorValue');
  for (const [balance, expected] of [[5_000n, 5_000n], [5_000n, 0n]] as const) {
    try {
      await deploy(art, [], balance, { initArgs: [expected] });
      console.log(`F3 initialBalance ${balance}, constructor requires msg.value == ${expected}: deployed`);
    } catch (e) {
      console.log(`F3 initialBalance ${balance}, constructor requires msg.value == ${expected}: ${firstLine(e)}`);
    }
  }
}

async function balanceRead(): Promise<void> {
  const art = artifact('BalanceRead');
  const layouts = art.abi.filter((f) => f.name === 'atLeast' || f.name === 'isEmpty').map((f) => {
    const slots = (f as unknown as { blockLayout?: { slots: Array<{ kind: string }> } }).blockLayout?.slots ?? [];
    return `${f.name}: [${slots.map((x) => x.kind).join(', ')}]`;
  });
  console.log(`F5 block layouts (no satoshiContainer slot): ${layouts.join('; ')}`);
  const { sc, key } = await deploy(art, [], 50_000n);
  for (const fn of ['atLeast', 'isEmpty']) {
    try {
      await entry(sc, fn, key).send();
      console.log(`F5 container holds 50000 sats, ${fn}: sent`);
    } catch (e) { console.log(`F5 container holds 50000 sats, ${fn}: ${firstLine(e)}`); }
  }
}

await framedLockingBytecode();
await transferOrder();
await constructorValue();
await balanceRead();
