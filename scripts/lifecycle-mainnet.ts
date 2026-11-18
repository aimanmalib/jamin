// The mainnet lifecycle run (called from scripts/lifecycle.ts --network mainnet). Uses the project's test wallet only,
// broadcasts only through a configured Electrum server and only behind the spending gate, and prints public
// addresses, txids and amounts; never the phrase or a key.
// Exit codes: 0 done, 1 a branch failed, 3 the wallet is not funded yet, 75 branch D waits for its time.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { loadConfig, repoRoot, type JaminConfig, type Role } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { readLedger, totalSpent } from '../src/budget/ledger.js';
import { lockOf, satsAt, type PartyName, type Terms } from '../src/lifecycle/context.js';
import { measure } from '../src/lifecycle/inspect.js';
import { walletContext } from '../src/lifecycle/mainnet.js';
import { runBranches } from '../src/lifecycle/mainnet-run.js';
import { addSteps, loadPending, readRecord, unmined, withHeights, writeRecord } from '../src/lifecycle/record.js';
import { childPath, deriveKey } from '../src/wallet/keys.js';
import { readEnvValue } from '../src/wallet/env-file.js';

const ROLE_OF: Record<PartyName, Role> = {
  seller: 'seller', buyer: 'buyer', arbitrator: 'arbitrator', arbiterB: 'arbiterB', arbiterC: 'arbiterC',
  fees: 'feeRecipient' };

function utc(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** The block a transaction was mined in, or undefined while it waits in the mempool. */
async function heightOf(electrum: ElectrumNetworkProvider, txid: string, tip: number): Promise<number | undefined> {
  try {
    const v = await electrum.performRequest('blockchain.transaction.get', txid, true) as { confirmations?: number };
    return v.confirmations ? tip - v.confirmations + 1 : undefined;
  } catch {
    return undefined;
  }
}

/** The seller balance a run must start with: a run of branch B alone pays fees and reserves only (decision 0012). */
export function fundingFloor(m: Pick<JaminConfig['mainnet'], 'minFundingSats' | 'tokenRunMinFundingSats'>,
  wanted: string[]): number {
  return wanted.length > 0 && wanted.every((b) => b === 'B') ? m.tokenRunMinFundingSats : m.minFundingSats;
}

export async function mainnetRun(wanted: string[]): Promise<number> {
  const cfg = loadConfig();
  const server = cfg.electrum.mainnet;
  if (!cfg.mainnet.broadcastHosts.includes(server.hostname)) {
    console.error(`refused: ${server.hostname} is not in mainnet.broadcastHosts`);
    return 2;
  }
  const phrase = process.env[cfg.wallet.mnemonicEnv] ?? readEnvValue(join(repoRoot, cfg.wallet.envFile), cfg.wallet.mnemonicEnv);
  if (!phrase) { console.error(`${cfg.wallet.mnemonicEnv} is not set; run: npm run wallet -- init`); return 2; }
  const derived = Object.fromEntries((Object.keys(ROLE_OF) as PartyName[]).map((p) =>
    [p, deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles[ROLE_OF[p]]))])) as
    Record<PartyName, ReturnType<typeof deriveKey>>;

  const electrum = new ElectrumNetworkProvider(Network.MAINNET,
    { hostname: server.hostname, port: server.port, encrypted: server.scheme === 'wss', manualConnectionManagement: true });
  const raw = electrum as unknown as NetworkProvider;
  await electrum.connect();
  try {
    const held = await satsAt(raw, derived.seller.address);
    console.log(`seller ${derived.seller.address} holds ${held} sat (${server.hostname})`);
    const floor = fundingFloor(cfg.mainnet, wanted);
    if (held < BigInt(floor) && !loadPending(join(repoRoot, cfg.mainnet.pendingFile))) {
      console.log(`not funded: needs at least ${floor} sat; nothing broadcast`);
      return 3;
    }
    const ledgerFile = join(repoRoot, cfg.mainnet.ledgerFile);
    const provider = gateProvider(raw, {
      ledgerFile, budgetSats: cfg.mainnet.budgetSats, note: 'lifecycle mainnet',
      walletLocks: new Set(Object.values(derived).map((k) => binToHex(lockOf(k.address)))),
    });
    const terms: Terms = {
      amount: BigInt(cfg.mainnet.escrowAmountSats), tokenAmount: BigInt(cfg.mainnet.tokenAmount),
      feeBps: BigInt(cfg.escrow.feeBps), disputeFee: BigInt(cfg.escrow.disputeFeeSats),
      waitSeconds: BigInt(cfg.escrow.sellerWaitingTimeSeconds), reserve: BigInt(cfg.escrow.containerReserveSats),
    };
    const keys = Object.fromEntries(Object.entries(derived).map(([p, k]) => [p, k.privateKey])) as
      Record<PartyName, Uint8Array>;
    const { ctx, steps } = await walletContext({ network: 'mainnet', provider, keys, terms,
      tokenCategory: cfg.tokens.pusd.category, genesisCoinSats: BigInt(cfg.mainnet.genesisCoinSats),
      partyFloatSats: BigInt(cfg.mainnet.partyFloatSats), feeRate: cfg.mainnet.feeRateSatsPerByte });
    const result = await runBranches(ctx, steps, wanted, join(repoRoot, cfg.mainnet.pendingFile));

    const tip = await raw.getBlockHeight();
    const measured = [];
    for (const s of steps) {
      const m = await measure(raw, s);
      const height = await heightOf(electrum, s.txid, tip);
      measured.push({ ...m, ...(height === undefined ? {} : { height }) });
      console.log(`${s.branch} ${s.step.padEnd(14)} ${s.txid} tx ${m.txBytes} B, unlock max ${m.maxUnlockingBytes} B, fee ${m.feeSats ?? "?"} sat`);
    }
    const recordFile = join(repoRoot, cfg.mainnetExamples);
    const record = addSteps(readRecord(recordFile), measured);
    // Steps an earlier run left in the mempool get their block height now.
    const heights = new Map<string, number>();
    for (const txid of unmined(record)) {
      const h = await heightOf(electrum, txid, tip);
      if (h !== undefined) heights.set(txid, h);
    }
    writeRecord(recordFile, withHeights(record, heights));
    const spent = totalSpent(readLedger(ledgerFile));
    const at = new Date().toISOString();
    const dir = join(repoRoot, cfg.mainnet.outputDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `run-${at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify({ at, server: server.hostname,
      failures: result.failures, skipped: result.skipped, spentSats: spent, steps: measured }, null, 2)}\n`);
    for (const s of result.skipped) console.log(`skipped ${s}`);
    for (const f of result.failures) console.log(`FAILED ${f.slice(0, 400)}`);
    console.log(`ledger: ${spent} of ${cfg.mainnet.budgetSats} sat spent; ${measured.length} transactions recorded`);
    if (result.failures.length > 0) return 1;
    if (result.waitingUntil !== undefined) {
      // Median time past runs about an hour behind the clock.
      console.log(`branch D waits: retry after ${utc(result.waitingUntil + 3_600n)} UTC`);
      return 75;
    }
    return 0;
  } finally {
    await electrum.disconnect();
  }
}
