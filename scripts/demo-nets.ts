// The test networks the demo scripts stage on: the SolidCash mock network (coins appear from nowhere) and a stock
// BCHN regtest node (coins from the node's wallet, through RegtestNetworkProvider). Mainnet is scripts/demo-mainnet.ts.
import { RegtestNetworkProvider, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { binToHex } from '@bitauth/libauth';
import type { JaminConfig } from '../src/config.js';
import type { Prefix } from '../src/demo/config.js';
import type { Pay } from '../src/demo/stage.js';
import { regtestRpc } from '../src/lifecycle/regtest.js';

export interface Net { provider: NetworkProvider; prefix: Prefix; pay: Pay; returnAddress: string; node: string }

function randomTxid(): string {
  return binToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function mockNet(): Promise<Net> {
  const mock = new MockNetworkProvider({ profile: 'production' });
  const [wallet] = await mock.getSigners(1);
  if (!wallet) throw new Error('mock signer missing');
  const pay: Pay = async (address, amounts) => {
    const txid = randomTxid();
    return Promise.all(amounts.map((satoshis, vout) => mock.seedUtxo(address, { txid, vout, satoshis })));
  };
  return { provider: mock as unknown as NetworkProvider, prefix: 'bchtest', pay, returnAddress: wallet.address,
    node: 'SolidCash MockNetworkProvider (production profile)' };
}

export async function regtestNet(cfg: JaminConfig): Promise<Net> {
  const rpcUrl = `http://127.0.0.1:${cfg.regtest.rpcPort}`;
  const user = process.env.REGTEST_RPC_USER ?? 'user';
  const password = process.env.REGTEST_RPC_PASSWORD ?? 'password';
  const regtest = new RegtestNetworkProvider({ rpcUrl, rpcUser: user, rpcPassword: password });
  const rpc = regtestRpc(rpcUrl, user, password);
  const zero = '00'.repeat(32);
  const pay: Pay = async (address, amounts) => {
    const out: Utxo[] = [];
    for (const satoshis of amounts) out.push(await regtest.addUtxo(address, { txid: zero, vout: 0, satoshis }));
    return out;
  };
  const node = (await rpc('getnetworkinfo') as { subversion: string }).subversion;
  return { provider: regtest as unknown as NetworkProvider, prefix: 'bchreg', pay,
    returnAddress: await rpc('getnewaddress') as string, node };
}
