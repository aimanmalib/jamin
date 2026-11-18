// Read-only by default: lists the coins every mainnet escrow of examples/mainnet.json still holds, tries every entry
// point of each contract by local evaluation (nothing is broadcast), and accounts for every satoshi of the test
// wallet. `--claim` sweeps event records whose relative lock has passed back to the wallet, through the spending gate.
// Prints public addresses, txids and amounts only; writes the report to mainnet.outputDir.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, decodeTransaction, hexToBin, type TransactionCommon } from '@bitauth/libauth';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { loadConfig, repoRoot } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { readLedger, totalSpent } from '../src/budget/ledger.js';
import { party, type Party, type PartyName } from '../src/lifecycle/context.js';
import { readRecord } from '../src/lifecycle/record.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';
import { readEnvValue } from '../src/wallet/env-file.js';
import type { ContractCoin } from '../src/coins/classify.js';
import { escrowRows, reconcile, type TxFlow } from '../src/coins/account.js';
import { attach, attachWalletBranch, headerTime, sitsAt } from '../src/coins/escrows.js';
import { surveyEscrow, type Survey } from '../src/coins/survey.js';
import { burnIdentity, eventSweep, lockHex, verbatim } from '../src/coins/paths.js';
import { ROLE_OF } from './lifecycle-mainnet.js';

const claim = process.argv.includes('--claim');
// `--early <branch>`: send that escrow's event sweep before its relative lock has passed, to record the refusal.
const earlyAt = process.argv.indexOf('--early');
const early = earlyAt > 0 ? process.argv[earlyAt + 1] : undefined;
const cfg = loadConfig();
const cc = cfg.mainnet.contractCoins;
const server = cfg.electrum.mainnet;
const phrase = process.env[cfg.wallet.mnemonicEnv] ?? readEnvValue(join(repoRoot, cfg.wallet.envFile), cfg.wallet.mnemonicEnv);
if (!phrase) throw new Error(`${cfg.wallet.mnemonicEnv} is not set`);
const keys = Object.fromEntries((Object.keys(ROLE_OF) as PartyName[]).map((p) =>
  [p, deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles[ROLE_OF[p]])).privateKey])) as Record<PartyName, Uint8Array>;

const electrum = new ElectrumNetworkProvider(Network.MAINNET,
  { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
const raw = electrum as unknown as NetworkProvider;
const partiesOn = (p: NetworkProvider): Record<PartyName, Party> =>
  Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, party(k, p)])) as Record<PartyName, Party>;
const parties = partiesOn(raw);
const walletAddresses = Object.values(parties).map((p) => p.address);
const walletLocks = new Set(walletAddresses.map(lockHex));

const txCache = new Map<string, TransactionCommon>();
async function tx(txid: string): Promise<TransactionCommon> {
  const hit = txCache.get(txid);
  if (hit) return hit;
  const t = decodeTransaction(hexToBin(await raw.getRawTransaction(txid)));
  if (typeof t === 'string') throw new Error(`${txid}: ${t}`);
  txCache.set(txid, t);
  return t;
}

/**
 * A transaction's flows. It belongs to an escrow when it is one of the escrow's steps or when it spends a coin one of
 * them created outside the wallet (an identity burn, an event sweep).
 */
async function flowOf(txid: string, branchOfTx: ReadonlyMap<string, string>): Promise<TxFlow> {
  const t = await tx(txid);
  let branch = branchOfTx.get(txid);
  const f = { walletIn: 0, walletOut: 0, otherIn: 0, otherOut: 0 };
  for (const i of t.inputs) {
    const prevId = binToHex(i.outpointTransactionHash);
    const prev = (await tx(prevId)).outputs[i.outpointIndex];
    if (!prev) throw new Error(`${txid} spends a missing output`);
    if (walletLocks.has(binToHex(prev.lockingBytecode))) f.walletIn += Number(prev.valueSatoshis);
    else {
      f.otherIn += Number(prev.valueSatoshis);
      branch ??= branchOfTx.get(prevId);
    }
  }
  for (const o of t.outputs) {
    if (walletLocks.has(binToHex(o.lockingBytecode))) f.walletOut += Number(o.valueSatoshis);
    else f.otherOut += Number(o.valueSatoshis);
  }
  return { txid, ...(branch === undefined ? {} : { branch }), ...f };
}

/** JSON for the report: amounts as numbers, bytes as hex. */
function plain(_key: string, v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return binToHex(v);
  return v;
}

await electrum.connect();
try {
  const record = readRecord(join(repoRoot, cfg.mainnetExamples));
  const tip = await raw.getBlockHeight();
  const heightOfTx = new Map<string, number>();
  const branchOfTx = new Map<string, string>();
  const allCoins: ContractCoin[] = [];
  for (const e of record.escrows) {
    for (const s of e.steps) {
      if (!('txid' in s) || typeof s.txid !== 'string') continue;
      branchOfTx.set(s.txid, e.branch);
      if (typeof s.height === 'number') heightOfTx.set(s.txid, s.height);
    }
  }
  const mtp = await raw.getMedianTimePast();
  const escrows: Survey[] = [];
  const sweeps: { branch: string; kind: 'event' | 'identity'; txid?: string; coins: number; satoshis: number; error?: string }[] = [];
  for (const e of record.escrows) {
    if (!e.address) continue;
    const category = e.asset === 'BCH' ? undefined : cfg.tokens.pusd.category;
    const txids = e.steps.flatMap((s) => ('txid' in s && typeof s.txid === 'string' ? [s.txid] : []));
    const created = heightOfTx.get(txids[0] ?? '') ?? tip;
    const attached = e.branch === 'W'
      ? await attachWalletBranch(e.address, parties, raw, { template: cfg.walletSigning.roleKeyMessage,
        site: new URL(cfg.site.url).host, network: 'mainnet', createdAt: created, depth: cc.walletBranchSearchBlocks,
        blockTime: async (h) => headerTime(await electrum.performRequest('blockchain.block.header', h) as string) })
      : await attach(e.address, parties, raw, category);
    if (!attached || !sitsAt(attached.sc, e.address)) { console.log(`${e.branch}: no contract matches ${e.address}`); continue; }
    const s = await surveyEscrow({ branch: e.branch, address: e.address, attached, provider: raw, keys, stepTxids: txids,
      heights: heightOfTx, walletLocks, tip, medianTimePast: mtp, relativeBlocks: cc.eventRelativeBlocks,
      feeRate: cfg.mainnet.feeRateSatsPerByte, mirrorFundingSats: BigInt(cc.mirrorFundingSats), identityFeeCoinSats: BigInt(cc.identityFeeCoinSats),
      sweepTo: parties.seller.address });
    escrows.push(s);
    allCoins.push(...s.coins);
    console.log(`${e.branch} status ${s.status}: ${s.coins.length} coins, ${s.coins.reduce((n, c) => n + c.satoshis, 0)} sat; `
      + s.paths.map((p) => `${p.path} ${p.outcome}${p.error ? ` (${p.error.slice(0, 120)})` : ''}`).join('; ')
      + `; event sweep ${s.eventSweep.outcome}${s.eventSweep.error ? ` (${s.eventSweep.error})` : ''}`
      + `, spendable from block ${s.eventSweep.spendableFromBlock ?? '-'}, ${s.ready.length} ready`
      + `; identity burn ${s.identityBurn.outcome}${s.identityBurn.error ? ` (${s.identityBurn.error})` : ''}`);
    const gated = gateProvider(raw, { ledgerFile: join(repoRoot, cfg.mainnet.ledgerFile), budgetSats: cfg.mainnet.budgetSats,
      note: `contract coins ${e.branch}`, walletLocks });
    if (claim && s.identity && s.identityBurn.outcome === 'accepted') {
      const satoshis = Number(s.identity.satoshis);
      try {
        const txid = await burnIdentity(gated, s.identity, partiesOn(gated).seller, BigInt(cc.identityFeeCoinSats));
        sweeps.push({ branch: e.branch, kind: 'identity', txid, coins: 1, satoshis });
        console.log(`${e.branch} identity burn ${txid}: ${satoshis} sat`);
      } catch (err) {
        sweeps.push({ branch: e.branch, kind: 'identity', coins: 1, satoshis, error: verbatim(err) });
        console.log(`${e.branch} identity burn refused: ${verbatim(err)}`);
      }
    }
    const sweepNow = e.branch === early ? s.events : claim ? s.ready : [];
    if (sweepNow.length > 0) {
      const satoshis = sweepNow.reduce((n, c) => n + Number(c.utxo.satoshis), 0);
      try {
        const { txid } = await eventSweep(attached.sc, gated, sweepNow, parties.seller.address, cfg.mainnet.feeRateSatsPerByte,
          cc.eventRelativeBlocks).send();
        sweeps.push({ branch: e.branch, kind: 'event', txid, coins: sweepNow.length, satoshis });
        console.log(`${e.branch} event sweep ${txid}: ${sweepNow.length} coins, ${satoshis} sat`);
      } catch (err) {
        sweeps.push({ branch: e.branch, kind: 'event', coins: sweepNow.length, satoshis, error: verbatim(err) });
        console.log(`${e.branch} event sweep refused: ${verbatim(err)}`);
      }
    }
  }

  const history = new Set<string>(branchOfTx.keys());
  for (const address of walletAddresses) {
    const h = await electrum.performRequest('blockchain.address.get_history', address) as { tx_hash: string }[];
    for (const x of h) history.add(x.tx_hash);
  }
  const flows: TxFlow[] = [];
  for (const txid of history) flows.push(await flowOf(txid, branchOfTx));
  let walletNow = 0;
  for (const address of walletAddresses) walletNow += Number((await raw.getUtxos(address)).reduce((s, u) => s + u.satoshis, 0n));
  const rows = escrowRows(flows);
  const totals = reconcile(flows, walletNow);
  const listedLocked = allCoins.reduce((s, c) => s + c.satoshis, 0);
  const ledgerSpent = totalSpent(readLedger(join(repoRoot, cfg.mainnet.ledgerFile)));
  for (const r of rows) console.log(`| ${r.branch} | ${r.transactions} | ${r.deposited} | ${r.paidOut} | ${r.minerFees} | ${r.locked} |`);
  console.log(JSON.stringify({ tip, ...totals, listedLocked, ledgerSpent, walletTransactions: flows.length }));
  const at = new Date().toISOString();
  const dir = join(repoRoot, cfg.mainnet.outputDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `coins-${at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify({ at, server: server.hostname, tip,
    escrows, sweeps, rows, totals, listedLocked, ledgerSpent, flows }, plain, 2)}\n`);
} finally {
  await electrum.disconnect();
}
