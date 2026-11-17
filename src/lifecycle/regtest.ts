// A lifecycle context on a BCHN regtest node (scripts/regtest-node.sh). The parties are derived from a phrase made
// for this run only and never stored: regtest coins have no value, and the mainnet test wallet is never used here.
import { RegtestNetworkProvider, type NetworkProvider, type Utxo } from '@solidcash/solidcash';
import { loadConfig } from '../config.js';
import { childPath, deriveKey, newMnemonic } from '../wallet/keys.js';
import { party, type Ctx, type PartyName, type Step, type Terms } from './context.js';

const ZERO_TXID = '00'.repeat(32);

export interface RegtestRun { ctx: Ctx; steps: Step[]; rpc: (method: string, params?: unknown[]) => Promise<unknown> }

export function regtestRpc(url: string, user: string, password: string) {
  return async (method: string, params: unknown[] = []): Promise<unknown> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${btoa(`${user}:${password}`)}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'jamin', method, params }),
    });
    const body = await res.json() as { result: unknown; error: { message: string } | null };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
}

export async function regtestContext(terms: Terms): Promise<RegtestRun> {
  const cfg = loadConfig();
  const rpcUrl = `http://127.0.0.1:${cfg.regtest.rpcPort}`;
  const rpcUser = process.env.REGTEST_RPC_USER ?? 'user';
  const rpcPassword = process.env.REGTEST_RPC_PASSWORD ?? 'password';
  const regtest = new RegtestNetworkProvider({ rpcUrl, rpcUser, rpcPassword });
  const provider = regtest as unknown as NetworkProvider;
  const phrase = newMnemonic();
  const keyOf = (role: keyof typeof cfg.wallet.roles): Uint8Array =>
    deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles[role]), 'bchreg').privateKey;
  const parties = {
    seller: party(keyOf('seller'), provider), buyer: party(keyOf('buyer'), provider),
    arbitrator: party(keyOf('arbitrator'), provider), fees: party(keyOf('feeRecipient'), provider),
  };
  const steps: Step[] = [];
  const fund = (p: PartyName, satoshis: bigint): Promise<Utxo> =>
    regtest.addUtxo(parties[p].address, { txid: ZERO_TXID, vout: 0, satoshis });
  for (const p of ['seller', 'buyer', 'arbitrator'] as const) await fund(p, BigInt(cfg.regtest.partySats));
  const ctx: Ctx = {
    network: 'regtest', provider, parties, terms,
    genesisCoin: async (p) => {
      const coin = await fund(p, BigInt(cfg.regtest.genesisCoinSats));
      if (coin.vout !== 0) throw new Error(`regtest funding came at output ${coin.vout}, a genesis needs output 0`);
      return coin;
    },
    tokenCoin: async (amount) => {
      const { categoryId, utxos } = await regtest.addTokenUtxos([
        { address: parties.seller.address, satoshis: 1_000n, token: { amount } },
      ]);
      const coin = utxos[0];
      if (!coin) throw new Error('regtest token genesis returned no coin');
      return { category: categoryId, coin };
    },
    waitUntil: async (timestamp) => {
      const mtp = BigInt(await regtest.getMedianTimePast());
      if (mtp < timestamp) await regtest.increaseTime(timestamp - mtp + 60n);
    },
    record: (s) => { steps.push(s); },
  };
  return { ctx, steps, rpc: regtestRpc(rpcUrl, rpcUser, rpcPassword) };
}
