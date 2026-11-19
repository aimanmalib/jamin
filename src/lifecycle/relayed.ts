// Branch T: a token escrow the buyer cancels through the keyless relayer (docs/decisions/0019-keyless-relayer.md).
// The seller creates the escrow and deposits the tokens; the buyer signs buyerCancel and does not broadcast it. The
// buyer writes the signed transaction and the intent (the escrow coins it spends and every output) to two files, and
// the relayer, a separate program holding no key, checks one against the other and broadcasts. The branch then checks
// that the seller has amount + fee back and the escrow is closed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, decodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { Status, openToken, stateOf } from './branches.js';
import { call, check, tokensAt, type Ctx } from './context.js';
import { capture } from './refused.js';
import { intentFor, type Outpoint, type RelayIntent } from '../relay/relay.js';

/** Every coin `hex` spends: the escrow's coins and the buyer's fee coin. */
export function spendsOf(hex: string): Outpoint[] {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(tx);
  return tx.inputs.map((i) => ({ txid: binToHex(i.outpointTransactionHash), vout: i.outpointIndex }));
}

/** Writes `<step>.hex` and `<step>.intent.json` into `dir` and returns their paths. */
export function writeRelayFiles(dir: string, step: string, hex: string, intent: RelayIntent): [string, string] {
  mkdirSync(dir, { recursive: true });
  const txFile = join(dir, `${step}.hex`);
  const intentFile = join(dir, `${step}.intent.json`);
  writeFileSync(txFile, `${hex}\n`);
  writeFileSync(intentFile, `${JSON.stringify(intent, null, 2)}\n`);
  return [txFile, intentFile];
}

export async function branchT(ctx: Ctx): Promise<void> {
  const relayer = ctx.relayer;
  if (!relayer) throw new Error('branch T needs a relayer (--relay buyerCancel)');
  const { sc, category, fee } = await openToken(ctx, 'T');
  const { seller, buyer } = ctx.parties;
  const before = await tokensAt(ctx.provider, seller.address, category);
  const hex = await capture(ctx.provider, () => call(sc, buyer, 'buyerCancel', category).send());
  const spends = spendsOf(hex);
  check(spends.length > 1, 'T: the cancel spends the escrow coins and a fee coin');
  const [txFile, intentFile] = writeRelayFiles(relayer.dir, 'T-buyerCancel', hex, intentFor(hex, spends));
  const txid = await relayer.send(txFile, intentFile);
  check(txid === hashTransaction(hexToBin(hex)), 'T: the relayer sent the bytes the buyer signed');
  ctx.record({ branch: 'T', step: 'buyerCancel', txid, relayed: true });
  check(await tokensAt(ctx.provider, seller.address, category) - before === ctx.terms.tokenAmount + fee,
    'T: the seller gets the token amount and fee back');
  check((await stateOf(sc)).status === Status.CancelledByBuyer, 'T: cancelled by the buyer');
}
