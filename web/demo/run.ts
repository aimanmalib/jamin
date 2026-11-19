// The "Release on mainnet" card's network side, in the browser. Live and dry modes attach to the demo escrow recorded
// in examples/mainnet.json and read it from the configured Electrum server; mock mode (`?demo=mock`, for tests)
// stages a demo escrow on the SolidCash mock network in this page first. Keys come from config/demo.json: public demo
// keys that guard at most maxSats (docs/decisions/0020-public-demo-escrow.md).
import { hexToBin } from '@bitauth/libauth';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import demoRaw from '../../config/demo.json' with { type: 'json' };
import { demoKeys, type DemoConfig, type Prefix } from '../../src/demo/config.js';
import { attachDemo, demoStatus, releaseDemo, type DemoParties, type DemoStatus, type Released } from '../../src/demo/escrow.js';
import { stageDemo, type Pay } from '../../src/demo/stage.js';
import { artifact } from '../sim/load.js';
import { config } from '../data/config.js';
import { demoMode, type DemoMode } from './mode.js';

export const demo = demoRaw as DemoConfig;

export interface DemoTarget { mode: DemoMode; provider: NetworkProvider; parties: DemoParties; address: string }

function parties(prefix: Prefix): DemoParties {
  return { keys: demoKeys(demo, prefix), feeRecipientPkh: hexToBin(config.walletTrade.feeRecipientPkh) };
}

function mainnetProvider(): NetworkProvider {
  const s = config.electrum.mainnet;
  return new ElectrumNetworkProvider(Network.MAINNET, { hostname: s.hostname, port: s.port,
    encrypted: s.scheme === 'wss' }) as unknown as NetworkProvider;
}

async function mockTarget(): Promise<DemoTarget> {
  const mock = new MockNetworkProvider({ profile: 'production' });
  const provider = mock as unknown as NetworkProvider;
  const [wallet] = await mock.getSigners(1);
  let n = 0;
  const pay: Pay = async (address, amounts) => {
    n += 1;
    const txid = n.toString(16).padStart(64, '0');
    return Promise.all(amounts.map((satoshis, vout) => mock.seedUtxo(address, { txid, vout, satoshis })));
  };
  const p = parties('bchtest');
  const e = config.escrow;
  const staged = await stageDemo(provider, await artifact('JaminEscrow'), demo, p, { feeBps: BigInt(e.feeBps),
    disputeFee: BigInt(e.disputeFeeSats), waitSeconds: BigInt(e.sellerWaitingTimeSeconds),
    reserve: BigInt(e.containerReserveSats), feeRate: 1 }, pay, wallet?.address ?? '');
  return { mode: 'mock', provider, parties: p, address: staged.address };
}

/** The escrow the card acts on, or undefined when no demo escrow is recorded on mainnet yet. */
export async function demoTarget(address: string | undefined, mode = demoMode()): Promise<DemoTarget | undefined> {
  if (mode === 'mock') return mockTarget();
  if (address === undefined) return undefined;
  return { mode, provider: mainnetProvider(), parties: parties('bitcoincash'), address };
}

export async function statusOf(t: DemoTarget): Promise<DemoStatus> {
  return demoStatus(await attachDemo(t.provider, await artifact('JaminEscrow'), t.parties, t.address));
}

/** Signs the release in this page; broadcasts it unless the mode is dry. */
export async function release(t: DemoTarget): Promise<Released> {
  return releaseDemo(t.provider, await artifact('JaminEscrow'), t.parties, t.address, t.mode === 'dry');
}

/** The newest transaction at `address` on the Electrum server: after a release, the release. */
export async function lastTx(t: DemoTarget): Promise<string | undefined> {
  if (t.mode === 'mock') return undefined;
  const history = await (t.provider as unknown as ElectrumNetworkProvider)
    .performRequest('blockchain.address.get_history', t.address) as { tx_hash: string; height: number }[];
  const sorted = [...history].sort((a, b) => (a.height <= 0 ? 1e9 : a.height) - (b.height <= 0 ? 1e9 : b.height));
  return sorted.at(-1)?.tx_hash;
}
