// The keyless relayer (docs/decisions/0019) on a real escrow: the seller signs a release it does not broadcast, a
// relayer that holds no key forwards it, and a relayer that changes where the coins go is stopped twice: by its own
// check against the seller's intent, and by the network, since the seller's signature and the covenant cover every
// output.
import { binToHex, decodeTransaction, encodeTransaction, hexToBin, type TransactionBCH } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { Status, TERMS, entry, satsAt, statusOf, world, type World } from './helpers/escrow.js';
import { paidBch } from './helpers/flows.js';
import { capture } from '../src/lifecycle/refused.js';
import { lockOf } from '../src/lifecycle/context.js';
import { RelayRefused, intentFor, relay, type Outpoint, type RelayIntent } from '../src/relay/relay.js';

function decoded(hex: string): TransactionBCH {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(tx);
  return tx;
}

const spendsOf = (hex: string): Outpoint[] => decoded(hex).inputs
  .map((i) => ({ txid: binToHex(i.outpointTransactionHash), vout: i.outpointIndex }));

/** A paid escrow and the release the seller signed but kept: the hex and the intent it hands to a relayer. */
async function signedRelease(w: World) {
  const sc = await paidBch(w);
  const hex = await capture(w.provider, () => entry(sc.connect(w.roles.seller), 'release', w.sig(w.roles.seller)).send());
  return { sc, hex, intent: intentFor(hex, spendsOf(hex)) };
}

/** `hex` with output `index` paid to `address` instead. */
function redirect(hex: string, index: number, address: string): string {
  const tx = decoded(hex);
  const outputs = tx.outputs.map((o, i) => (i === index ? { ...o, lockingBytecode: lockOf(address) } : o));
  return binToHex(encodeTransaction({ ...tx, outputs }));
}

/** The output index that pays the buyer the trade amount. */
function buyerOutput(w: World, intent: RelayIntent): number {
  const lock = binToHex(lockOf(w.roles.buyer.address));
  const i = intent.outputs.findIndex((o) => o.lockingBytecode === lock && BigInt(o.satoshis) === TERMS.amount);
  if (i < 0) throw new Error('no output pays the buyer the amount');
  return i;
}

describe('keyless relayer', () => {
  it('forwards a release the seller signed, byte for byte, and the buyer is paid', async () => {
    const w = await world();
    const { sc, hex, intent } = await signedRelease(w);
    expect(await statusOf(sc)).toBe(Status.Paid);
    const before = await satsAt(w.provider, w.roles.buyer.address);
    const sent: string[] = [];
    const txid = await relay(hex, intent, (h) => { sent.push(h); return w.provider.sendRawTransaction(h); });
    expect(sent).toEqual([hex]);
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    expect(await statusOf(sc)).toBe(Status.Released);
    expect(await satsAt(w.provider, w.roles.buyer.address) - before).toBe(TERMS.amount);
  });

  it('refuses, before sending, a release whose buyer output was redirected to another address', async () => {
    const w = await world();
    const { sc, hex, intent } = await signedRelease(w);
    const tampered = redirect(hex, buyerOutput(w, intent), w.roles.outsider.address);
    let sends = 0;
    const attempt = relay(tampered, intent, () => { sends += 1; return Promise.resolve('0'.repeat(64)); });
    await expect(attempt).rejects.toThrow(RelayRefused);
    await expect(attempt).rejects.toThrow(/output \d+ differs from the intent/);
    expect(sends).toBe(0);
    expect(await statusOf(sc)).toBe(Status.Paid);
  });

  it('a relayer that rewrites the intent too is refused by the network, and the signed release still goes through', async () => {
    const w = await world();
    const { sc, hex, intent } = await signedRelease(w);
    const tampered = redirect(hex, buyerOutput(w, intent), w.roles.outsider.address);
    const forged = intentFor(tampered, intent.spends);
    const outsider = await satsAt(w.provider, w.roles.outsider.address);
    await expect(relay(tampered, forged, (h) => w.provider.sendRawTransaction(h))).rejects.toThrow();
    expect(await statusOf(sc)).toBe(Status.Paid);
    expect(await satsAt(w.provider, w.roles.outsider.address)).toBe(outsider);
    await relay(hex, intent, (h) => w.provider.sendRawTransaction(h));
    expect(await statusOf(sc)).toBe(Status.Released);
  });
});
