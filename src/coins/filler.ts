// The filler: an output the SDK leaves at an index when nothing else sits there, such as the slot of a token
// container that a first deposit appends after the block. Every filler sits at the same P2SH32 lock, whose script is
// `<144> OP_CHECKSEQUENCEVERIFY OP_DROP OP_1`: anyone may spend it 144 blocks after it was mined. The SDK builds the
// output but has no helper that spends it, so the lock and its unlock are written out here from that script.
import { cashAddressToLockingBytecode, encodeDataPush, hash256, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import type { Unlocker } from '@solidcash/solidcash';

/** `<144> OP_CHECKSEQUENCEVERIFY OP_DROP OP_1`: 144 is the minimal script number 0x9000. */
export const FILLER_REDEEM_SCRIPT = Uint8Array.from([0x02, 0x90, 0x00, 0xb2, 0x75, 0x51]);

/** The relative lock, in blocks, the filler script checks. */
export const FILLER_RELATIVE_BLOCKS = 144;

/** OP_HASH256 <32-byte script hash> OP_EQUAL. */
export function fillerLock(): Uint8Array {
  return Uint8Array.from([0xaa, 0x20, ...hash256(FILLER_REDEEM_SCRIPT), 0x87]);
}

export function fillerAddress(prefix: 'bitcoincash' | 'bchreg' | 'bchtest' = 'bitcoincash'): string {
  const a = lockingBytecodeToCashAddress({ bytecode: fillerLock(), prefix });
  if (typeof a === 'string') throw new Error(a);
  return a.address;
}

export function isFillerAddress(address: string): boolean {
  const lock = cashAddressToLockingBytecode(address);
  if (typeof lock === 'string') return false;
  const want = fillerLock();
  return lock.bytecode.length === want.length && lock.bytecode.every((b, i) => b === want[i]);
}

/** Spends a filler: the unlock only pushes the script; the input's sequence must be FILLER_RELATIVE_BLOCKS or more. */
export function fillerUnlocker(): Unlocker {
  return {
    generateLockingBytecode: fillerLock,
    generateUnlockingBytecode: () => encodeDataPush(FILLER_REDEEM_SCRIPT),
  };
}
