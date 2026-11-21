// What the Wallet tab says when a step stops (decision 0027): a wallet short of coins at one address gets the
// language text that explains it and suggests gathering coins inside the visitor's own wallet; other errors keep their
// message with any address taken out, so no raw SDK text reads like a request to send coins somewhere. A request the
// wallet can no longer answer because the session ended, and a wallet that never connected, get their own text (0028).
import { NoPayer } from '../../src/wallet/payer.js';
import { formatBalance } from './format.js';
import { SessionEnded } from './link.js';
import { config } from '../data/config.js';

type T = (key: string, vars?: Record<string, string | number>) => string;

const ADDRESS = /\b(?:bitcoincash|bchtest|bchreg):[a-z0-9]+/g;
const SHORT_OF_FUNDS = /insufficient|not enough|no coin|funds|utxo/i;

export function shortOfCoins(t: T, need: number, total: number, largest: number): string {
  const bch = (sats: number): string => formatBalance({ sats, tokenUnits: 0 }).bch;
  return total >= need ? t('wallet.spread', { total: bch(total), largest: bch(largest), need })
    : t('wallet.notEnough', { total: bch(total), need });
}

export function failureText(t: T, e: unknown): string {
  if (e instanceof NoPayer) return shortOfCoins(t, e.need, e.total, e.largest);
  if (e instanceof SessionEnded) return t('wallet.endedSign');
  if (e instanceof Error && e.message === 'timeout') {
    return t('wallet.timeout', { seconds: Math.round(config.walletTrade.connectTimeoutMs / 1000) });
  }
  const message = (e instanceof Error ? e.message : String(e)).replace(ADDRESS, '…');
  return t('wallet.failed', { message: SHORT_OF_FUNDS.test(message) ? t('wallet.failedFunds') : message });
}
