// The header chip's balance text: BCH to eight places at most, and the PUSD units in the token's decimals when any.
import { config } from '../data/config.js';
import type { Balance } from './store.js';

const SATS_PER_BCH = 100_000_000;

export function formatBalance(b: Balance, token = config.tokens.pusd): { bch: string; token: string } {
  return {
    bch: `${(b.sats / SATS_PER_BCH).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} BCH`,
    token: b.tokenUnits > 0 ? `${(b.tokenUnits / 10 ** token.decimals).toFixed(token.decimals)} ${token.symbol}` : '',
  };
}
