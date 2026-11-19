import { describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import { TransactionBuilder, randomUtxo, utils } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { asProvider } from '../src/sdk/mock.js';
import { FILLER_RELATIVE_BLOCKS, fillerAddress, fillerLock, fillerUnlocker, isFillerAddress } from '../src/coins/filler.js';

// The address output 3 of branch B's mainnet deposit (d46f258d...) paid 576 sats to, read from the chain.
const SEEN_ON_MAINNET = 'bitcoincash:p0zzcyw3hq83atjvqf8uwewap3thq89r496908umhesqq70qtx602qgtw9tlu';
const PAY_TO = 'bitcoincash:qqjjt27z8wc44lkdd9x8jm3e2az8a5xleu92s5nusl';
// The mock network's first evaluation loads the VM: seconds on a busy host.
const SLOW = 120_000;

async function spend(sequence: number): Promise<string> {
  const mock = new MockNetworkProvider();
  const coin = randomUtxo({ satoshis: 10_000n });
  await mock.addUtxo(fillerAddress(), coin);
  const tx = new TransactionBuilder({ provider: asProvider(mock) }).addInput(coin, fillerUnlocker(), { sequence })
    .addOutput({ to: PAY_TO, amount: 9_000n });
  return (await tx.send()).txid;
}

describe('filler', () => {
  it('is the lock the SDK builds fillers at, and the address the mainnet deposit paid', () => {
    expect(binToHex(fillerLock())).toBe(binToHex(utils.fillerLockingBytecode()));
    expect(fillerAddress()).toBe(SEEN_ON_MAINNET);
    expect(isFillerAddress(SEEN_ON_MAINNET)).toBe(true);
    expect(isFillerAddress(PAY_TO)).toBe(false);
    expect(FILLER_RELATIVE_BLOCKS).toBe(144);
  });

  it('is spent by anyone once its 144-block relative lock has passed', async () => {
    await expect(spend(FILLER_RELATIVE_BLOCKS)).resolves.toMatch(/^[0-9a-f]{64}$/);
  }, SLOW);

  it('is refused a block early', async () => {
    await expect(spend(FILLER_RELATIVE_BLOCKS - 1)).rejects.toThrow(/OP_CHECKSEQUENCEVERIFY/);
  }, SLOW);
});
