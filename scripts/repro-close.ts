// Reproduction for docs/SOLIDCASH-FINDINGS.md F11 to F13 and docs/decisions/0013: closing a finished escrow with
// `selfdestruct(seller)`. The escrow contracts are copied to a temporary folder, given the `close` function that
// decision 0013 measured, and compiled; nothing in contracts/ changes and nothing is broadcast.
// Usage: npx tsx scripts/repro-close.ts
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileFileMulti } from '@solidcash/solidc';
import type { Artifact, NetworkProvider } from '@solidcash/solidcash';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { asProvider, entry } from '../src/sdk/mock.js';
import { RESERVE_SATS, TERMS, fundingCoin, roleParams, world, type World } from '../test/helpers/escrow.js';
import { BCH_FEE, TOKEN, tokenWorld } from '../test/helpers/flows.js';

const CLOSE = `
    function close(sig s) public onlySeller(s) {
        require(isFinished(), NotFinished());
        selfdestruct(new LockingBytecodeP2PKH(hash160(seller)));
    }
}
`;

const FINISHED = `    error NotFinished();

    function isFinished() internal view returns (bool) {
        return this.status == Status.Released || this.status == Status.CancelledByBuyer
            || this.status == Status.CancelledBySeller || this.status == Status.Resolved;
    }
}
`;

/** The two escrow contracts with `close`, compiled from a temporary copy of contracts/. */
function closableArtifacts(): Record<'JaminEscrow' | 'JaminTokenEscrow', Artifact> {
  const dir = mkdtempSync(join(tmpdir(), 'jamin-close-'));
  // The compiler may read the imports again after this returns, so the copy is removed when the script exits.
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  for (const f of readdirSync('contracts')) copyFileSync(join('contracts', f), join(dir, f));
  const append = (file: string, text: string): void => {
    const src = readFileSync(join(dir, file), 'utf8').trimEnd();
    writeFileSync(join(dir, file), src.slice(0, src.lastIndexOf('}')) + text);
  };
  append('EscrowBase.scash', FINISHED);
  append('JaminEscrow.scash', CLOSE);
  append('JaminTokenEscrow.scash', CLOSE);
  const pick = (name: string): Artifact =>
    (compileFileMulti(join(dir, `${name}.scash`), { evmCompat: false } as never) as unknown as Record<string, Artifact>)[name] as Artifact;
  return { JaminEscrow: pick('JaminEscrow'), JaminTokenEscrow: pick('JaminTokenEscrow') };
}

function firstLine(error: unknown): string {
  return (String(error instanceof Error ? error.message : error).split('\n')[0] ?? '').slice(0, 240);
}

/** The provider without the escrow's event records (immutable NFTs of its category), as if they were left out. */
function withoutEvents(provider: NetworkProvider, category: string): NetworkProvider {
  return new Proxy(provider, { get(target, key, receiver) {
    if (key === 'getUtxos') {
      return async (address: string) => (await target.getUtxos(address))
        .filter((u) => !(u.token?.category === category && u.token.nft?.capability === 'none'));
    }
    const value: unknown = Reflect.get(target, key, receiver);
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  } });
}

async function released(w: World, art: Artifact, extra: unknown[], init: unknown[]) {
  const { seller, buyer } = w.roles;
  const { contract, categoryId } = await StatefulContract.deploy(art, [...roleParams(w.roles), ...extra] as never, {
    provider: asProvider(w.provider), fundingUtxo: await fundingCoin(w.provider, seller), funder: seller.unlockP2PKH(),
    changeAddress: seller.address, initArgs: init as never, initialBalance: RESERVE_SATS });
  return { sc: contract.connect(seller), categoryId, seller, buyer };
}

async function attempt(label: string, w: World, sc: StatefulContract, provider: NetworkProvider,
  options: { fee?: bigint; maxFee?: bigint; tokens?: string[] }): Promise<void> {
  const { seller } = w.roles;
  try {
    const r = await StatefulContract.selfdestructTo({ provider, contract: sc.connect(seller) as never,
      destroyFunctionName: 'close', destroyFunctionArgs: [w.sig(seller)], recipient: seller.address,
      ...(options.fee === undefined ? {} : { fee: options.fee }), ...(options.maxFee === undefined ? {} : { maxFee: options.maxFee }),
      ...(options.tokens ? { tokenContainerCategoryIds: options.tokens } : {}) });
    console.log(`${label}: sent ${r.txs.length} transaction(s), reclaimed ${r.totalReclaimed} sats`);
  } catch (e) { console.log(`${label}: ${firstLine(e)}`); }
}

const arts = closableArtifacts();

{
  const w = await world();
  const { sc, categoryId, seller, buyer } = await released(w, arts.JaminEscrow, [],
    [TERMS.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
  await entry(sc, 'fund', w.sig(seller)).withValue(TERMS.amount + BCH_FEE).send();
  await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer)).send();
  await entry(sc, 'release', w.sig(seller)).send();
  const bare = withoutEvents(asProvider(w.provider), categoryId);
  await attempt('F12 BCH escrow released, close with the SDK defaults', w, sc, asProvider(w.provider), {});
  await attempt('F11 BCH escrow released, event records left out, fee from size', w, sc, bare, {});
  await attempt('F11 BCH escrow released, event records left out, fee 1,999 sats', w, sc, bare, { fee: 1_999n });
}

{
  const w = await tokenWorld();
  const { sc, categoryId, seller, buyer } = await released(w, arts.JaminTokenEscrow, [w.category],
    [TOKEN.amount, TERMS.feeBps, TERMS.disputeFee, w.cancelAfter]);
  await entry(sc, 'deposit', w.sig(seller), w.category).addInput(w.sellerCoin, seller.unlockP2PKH())
    .tokenContainerDeposit(w.category, TOKEN.amount + TOKEN.fee + TOKEN.reserve).send();
  await entry(sc.connect(buyer), 'markAsPaid', w.sig(buyer), w.category).send();
  await entry(sc, 'release', w.sig(seller), w.category).send();
  const bare = withoutEvents(asProvider(w.provider), categoryId);
  await attempt('F13 token escrow released, token container named, fee 1,999 sats', w, sc, bare,
    { fee: 1_999n, tokens: [w.category] });
}
