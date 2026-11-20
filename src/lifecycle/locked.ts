// What a fund or deposit transaction put into an escrow, read from the transaction itself (Electrum verbose form).
// The SDK's fund/deposit transaction has token-carrying outputs for the escrow's state, one plain output for the
// satoshi container and the wallet's change last. A BCH escrow locks the container's value (amount, fee and
// container reserve); a token escrow locks the token container's fungible units of the given category.

export interface VerboseOutput { value: number; tokenData?: { category?: string; amount?: string } }

export type Locked = { lockedSats: number } | { lockedUnits: number };

/** Satoshis of a verbose output, from its BCH `value`. */
export const satsOf = (o: VerboseOutput): number => Math.round(o.value * 1e8);

/** The amount locked by a fund (`asset` BCH) or deposit (`asset` a token symbol) transaction. Throws when unclear. */
export function lockedOf(vout: VerboseOutput[], asset: string, category: string): Locked {
  if (asset === 'BCH') {
    const plain = vout.slice(0, -1).filter((o) => o.tokenData === undefined);
    if (plain.length !== 1) throw new Error(`expected one satoshi container output, found ${plain.length}`);
    return { lockedSats: satsOf(plain[0] as VerboseOutput) };
  }
  const units = vout.filter((o) => o.tokenData?.category === category && BigInt(o.tokenData.amount ?? '0') > 0n);
  if (units.length !== 1) throw new Error(`expected one ${asset} token container output, found ${units.length}`);
  return { lockedUnits: Number(BigInt(units[0]?.tokenData?.amount ?? '0')) };
}

/** The steps that lock coins: fund for a BCH escrow, deposit for a token escrow. */
export const LOCKING_STEPS = ['fund', 'deposit'];

interface Row { step: string; txid?: string; refused?: true; lockedSats?: number; lockedUnits?: number }
interface Rec<R extends Row> { escrows: { asset: string; steps: R[] }[] }

/** Txids of locking steps that carry no locked amount yet. */
export function unlockedTxids<R extends Row>(record: Rec<R>): string[] {
  return record.escrows.flatMap((e) => e.steps.flatMap((s) => (LOCKING_STEPS.includes(s.step) && s.refused !== true
    && s.txid !== undefined && s.lockedSats === undefined && s.lockedUnits === undefined ? [s.txid] : [])));
}

/** The record with each locking step in `amounts` (txid to amount) given its locked amount. */
export function withLocked<R extends Row, T extends Rec<R>>(record: T, amounts: Map<string, Locked>): T {
  return { ...record, escrows: record.escrows.map((e) => ({ ...e, steps: e.steps.map((s) => {
    const a = s.txid === undefined ? undefined : amounts.get(s.txid);
    return a === undefined || s.refused === true ? s : { ...s, ...a };
  }) })) };
}
