// The opening of the README and of slides 1 and 2 (decision 0024): the home page's title sentence, what a visitor can
// press, and three mainnet numbers counted from examples/mainnet.json by the same functions as the Home stats strip.
import { readFileSync } from 'node:fs';
import { bchText, recordedStats, tokenText } from '../web/data/stats.js';

const en = JSON.parse(readFileSync('lang/en.json', 'utf8')) as { home: { title: string } };
const config = JSON.parse(readFileSync('config/jamin.json', 'utf8')) as { tokens: { pusd: { decimals: number } } };

/** The home page's title sentence, which the README and slide 1 repeat word for word. */
export const heroSentence = en.home.title;

/** The three mainnet numbers, as the README and slide 2 state them. */
export function countsLine(stats = recordedStats()): string {
  return `On mainnet so far: ${stats.escrows} escrows, ${bchText(stats.lockedSats, 'en-US')} BCH and ` +
    `${tokenText(stats.lockedUnits, config.tokens.pusd.decimals, 'en-US')} PUSD locked in them, and ${stats.refused} calls refused by the network.`;
}
