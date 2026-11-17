// Turns a rejected transaction's message into the contract error's name for the simulator log.

/** Custom errors declared in contracts/EscrowBase.scash and contracts/JaminTokenEscrow.scash. */
export const ERROR_NAMES = ['InvalidAmount', 'InvalidDisputeFee', 'InvalidCancelTime', 'NotSeller', 'NotBuyer',
  'NotArbitrator', 'NotFunded', 'AlreadyFunded', 'WrongDeposit', 'NotOpen', 'AlreadyMarkedPaid', 'TooEarly', 'NotPaid',
  'WrongDisputeFee', 'AlreadyPaidDispute', 'NoDispute', 'WrongToken'] as const;

export type RejectionName = (typeof ERROR_NAMES)[number] | 'Rejected';

/**
 * The first contract error named in `message`. `require(tx.time >= ...)` compiles to OP_CHECKLOCKTIMEVERIFY, so a
 * seller cancel before the waiting time fails on the locktime instead of naming TooEarly
 * (docs/SOLIDCASH-FINDINGS.md, F7); that failure is reported as TooEarly.
 */
export function rejectionName(message: string): RejectionName {
  for (const name of ERROR_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(message)) return name;
  }
  if (/locktime/i.test(message)) return 'TooEarly';
  return 'Rejected';
}
