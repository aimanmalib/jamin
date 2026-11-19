// A relayer without keys (docs/decisions/0019-keyless-relayer.md). A party that signed an escrow call but cannot
// broadcast it hands over the signed transaction and the intent it signed: the escrow coin it spends and every
// output it pays. The relayer only compares and forwards. It refuses a transaction that differs from the intent,
// sends the bytes it was given unchanged, and refuses a send that reports another transaction id. It is given no
// key and no signer, and it cannot pay for anything: the fee is already inside the signed transaction.
import { binToHex, decodeTransaction, hashTransaction, hexToBin, type Output } from '@bitauth/libauth';

export interface Outpoint { txid: string; vout: number }

/** One output as the signing party agreed to it. Values are strings so the intent is plain JSON. */
export interface IntentOutput {
  lockingBytecode: string;
  satoshis: string;
  token?: { category: string; amount: string; nft?: { capability: string; commitment: string } };
}

/** What the signing party publishes next to its signed transaction. */
export interface RelayIntent {
  /** Coins the transaction must spend (the escrow coin at least). */
  spends: Outpoint[];
  /** Every output, in order. */
  outputs: IntentOutput[];
}

/** Sends raw transaction hex to the network and returns the txid it reports. */
export type Broadcast = (hex: string) => Promise<string>;

/** Thrown when the relayer refuses to forward a transaction; nothing was sent. */
export class RelayRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(`relay refused: ${reasons.join('; ')}`);
    this.name = 'RelayRefused';
  }
}

export function intentOutput(out: Output): IntentOutput {
  const o: IntentOutput = { lockingBytecode: binToHex(out.lockingBytecode), satoshis: out.valueSatoshis.toString() };
  if (out.token) {
    o.token = { category: binToHex(out.token.category), amount: out.token.amount.toString() };
    if (out.token.nft) {
      o.token.nft = { capability: out.token.nft.capability, commitment: binToHex(out.token.nft.commitment) };
    }
  }
  return o;
}

/** The intent a signing party writes for a transaction it signed: the coins named in `spends` and every output. */
export function intentFor(hex: string, spends: Outpoint[]): RelayIntent {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(`cannot decode the transaction: ${tx}`);
  return { spends, outputs: tx.outputs.map(intentOutput) };
}

/** One canonical line for an output, so two outputs compare equal only when every field does. */
function key(o: IntentOutput): string {
  const t = o.token;
  const token = t ? `${t.category.toLowerCase()}:${t.amount}:${t.nft ? `${t.nft.capability}:${t.nft.commitment.toLowerCase()}` : '-'}` : '-';
  return `${o.lockingBytecode.toLowerCase()}|${o.satoshis}|${token}`;
}

/** Every way `hex` differs from `intent`; empty when the relayer may forward it. */
export function checkRelay(hex: string, intent: RelayIntent): string[] {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return ['not a hex transaction'];
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') return [`cannot decode the transaction: ${tx}`];
  const reasons: string[] = [];
  const spent = new Set(tx.inputs.map((i) => `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`));
  if (intent.spends.length === 0) reasons.push('the intent names no coin to spend');
  for (const s of intent.spends) {
    if (!spent.has(`${s.txid.toLowerCase()}:${s.vout}`)) reasons.push(`does not spend ${s.txid}:${s.vout}`);
  }
  if (tx.outputs.length !== intent.outputs.length) {
    reasons.push(`has ${tx.outputs.length} outputs, the intent ${intent.outputs.length}`);
  }
  tx.outputs.forEach((out, i) => {
    const want = intent.outputs[i];
    if (want && key(intentOutput(out)) !== key(want)) reasons.push(`output ${i} differs from the intent`);
  });
  return reasons;
}

/**
 * Forwards `hex` unchanged when it matches `intent`, and returns the txid. Refuses before sending when it does not
 * match, and refuses after sending when the network reports another txid than the one the bytes hash to.
 */
export async function relay(hex: string, intent: RelayIntent, send: Broadcast): Promise<string> {
  const reasons = checkRelay(hex, intent);
  if (reasons.length > 0) throw new RelayRefused(reasons);
  const expected = hashTransaction(hexToBin(hex));
  const txid = await send(hex);
  if (txid !== expected) throw new RelayRefused([`the network reported ${txid}, the signed transaction is ${expected}`]);
  return txid;
}
