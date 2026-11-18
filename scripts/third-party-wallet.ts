// Branch X on mainnet (decision 0014): a Cashonize build signs as the seller on the site's "Wallet" tab.
//   tsx scripts/third-party-wallet.ts --cashonize <built spa dir> [--site <url>] [--port 9052] [--dry]
// Cashonize runs in Playwright with its own phrase (`mainnet.thirdPartyWallet.mnemonicEnv` in .env, made here once
// and never printed), and connects to the page over WizardConnect. The project's test wallet funds it once through
// the spending gate and its buyer key marks the trade paid; the page builds and broadcasts the seller's steps.
// `--dry` stops after the role key request (no funds move). Prints addresses, txids and file names only; the pairing
// link and the phrase are never printed, and screenshots show only Cashonize's sign dialog and the page after it.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import { binToHex } from '@bitauth/libauth';
import { Network, type NetworkProvider } from '@solidcash/solidcash';
import { ElectrumNetworkProvider } from '@solidcash/solidcash/network/electrum';
import { loadConfig, repoRoot } from '../src/config.js';
import { gateProvider } from '../src/budget/gate.js';
import { lockOf, party } from '../src/lifecycle/context.js';
import { measure } from '../src/lifecycle/inspect.js';
import { addSteps, readRecord, writeRecord } from '../src/lifecycle/record.js';
import { attachEscrow, branchXSteps, buyerMarksPaid, fundWallet, keysFrom } from '../src/lifecycle/third-party.js';
import { childPath, deriveKey, newMnemonic } from '../src/wallet/keys.js';
import { readEnvValue, writeEnvValueOnce } from '../src/wallet/env-file.js';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const cfg = loadConfig();
const tp = cfg.mainnet.thirdPartyWallet;
const SPA = arg('--cashonize');
const SITE = arg('--site') ?? cfg.site.url;
const PORT = Number(arg('--port') ?? 9052);
const DRY = process.argv.includes('--dry');
const SHOTS = process.env.AUTOPILOT_BUKTI_DIR ?? join(repoRoot, cfg.mainnet.outputDir);
const ENV = join(repoRoot, cfg.wallet.envFile);
const log = (m: string): void => { console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); };
if (!SPA) { console.error('usage: tsx scripts/third-party-wallet.ts --cashonize <dir> [--site url] [--dry]'); process.exit(2); }
if (tp.fundSats > tp.maxFundSats) { console.error('thirdPartyWallet.fundSats is above maxFundSats'); process.exit(2); }
if (!cfg.mainnet.broadcastHosts.includes(cfg.electrum.mainnet.hostname)) { console.error('server not allowed'); process.exit(2); }
const phrase = readEnvValue(ENV, cfg.wallet.mnemonicEnv);
if (!phrase) { console.error(`${cfg.wallet.mnemonicEnv} missing`); process.exit(2); }
if (readEnvValue(ENV, tp.mnemonicEnv) === undefined) { writeEnvValueOnce(ENV, tp.mnemonicEnv, newMnemonic()); log(`${tp.mnemonicEnv} made (not printed)`); }
const w3 = readEnvValue(ENV, tp.mnemonicEnv) ?? '';

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  const file = join(SPA, path === '/' ? 'index.html' : path);
  try { res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file)); }
  catch { res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(SPA, 'index.html'))); }
});
await new Promise<void>((r) => { server.listen(PORT, '127.0.0.1', r); });

const s = cfg.electrum.mainnet;
const electrum = new ElectrumNetworkProvider(Network.MAINNET, { hostname: s.hostname, port: s.port,
  encrypted: s.scheme === 'wss', manualConnectionManagement: true });
const raw = electrum as unknown as NetworkProvider;
const roles = ['seller', 'buyer', 'arbitrator', 'feeRecipient', 'arbiterB', 'arbiterC'] as const;
const keys = Object.fromEntries(roles.map((r) => [r, deriveKey(phrase, childPath(cfg.wallet.derivationBase, cfg.wallet.roles[r]))]));
const gated = gateProvider(raw, { ledgerFile: join(repoRoot, cfg.mainnet.ledgerFile), budgetSats: cfg.mainnet.budgetSats,
  note: `branch ${tp.branch}`, walletLocks: new Set(Object.values(keys).map((k) => binToHex(lockOf(k.address)))) });
const as = (r: (typeof roles)[number]) => party((keys[r] ?? (() => { throw new Error(r); })()).privateKey, gated);
const browser = await chromium.launch();

/** Approves every Cashonize sign dialog until `done` shows on the page; the first is captured as `shot`. */
async function signUntil(wallet: Page, site: Page, done: Locator, shot: string): Promise<void> {
  const dialog = wallet.locator('.q-dialog:visible').last();
  const failed = site.getByTestId('wallet-error');
  for (let n = 0; ; n++) {
    const which = await Promise.race([
      dialog.getByRole('button', { name: 'Sign' }).waitFor({ timeout: 240_000 }).then(() => 'sign'),
      done.waitFor({ timeout: 240_000 }).then(() => 'done'),
      failed.waitFor({ timeout: 240_000 }).then(() => 'failed'),
    ]);
    if (which === 'done') return;
    if (which === 'failed') throw new Error(await failed.innerText());
    await wallet.waitForTimeout(800);
    if (n === 0) await dialog.screenshot({ path: join(SHOTS, `jamin-x-cashonize-${shot}.png`) });
    await dialog.getByRole('button', { name: 'Sign' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
    log(`Cashonize signed (${shot} ${n + 1})`);
  }
}

await electrum.connect();
try {
  const wallet = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })).newPage();
  await wallet.goto(`http://127.0.0.1:${PORT}/`);
  await wallet.getByRole('button', { name: 'Import wallet' }).first().click();
  await wallet.locator('select').first().selectOption('hd');
  await wallet.locator('.seed-word-input input').first().fill(w3);
  await wallet.getByRole('button', { name: 'Import wallet' }).last().click();
  await wallet.getByRole('button', { name: 'Finish Setup' }).click();
  await wallet.locator('nav').waitFor({ timeout: 60_000 });
  log('Cashonize: third-party wallet imported');

  const site = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'en-US' })).newPage();
  await site.goto(`${SITE}/#/wallet`);
  await site.getByTestId('buyer-key').fill(binToHex(keys.buyer?.publicKey ?? new Uint8Array()));
  await site.getByTestId('wallet-connect').click();
  const link = await site.getByTestId('wallet-link').inputValue({ timeout: 60_000 });
  await wallet.locator('nav').getByText('Connect', { exact: true }).click();
  await wallet.getByPlaceholder('Connection URI').fill(link);
  await wallet.locator('input.primaryButton[value*="Connect"]').click();
  const consent = wallet.locator('.q-dialog:visible').last();
  await consent.waitFor({ timeout: 60_000 });
  await consent.getByRole('button', { name: 'Connect', exact: true }).click();
  await signUntil(wallet, site, site.getByTestId('wallet-connected'), 'role-key');
  const address = await site.getByTestId('wallet-address').innerText();
  const roleKey = await site.getByTestId('role-key').innerText();
  log(`connected; wallet ${address}; seller key in the escrow ${roleKey}`);
  if (DRY) { await site.screenshot({ path: join(SHOTS, 'jamin-x-site-connected.png') }); process.exitCode = 0; }
  else {
    const need = BigInt(cfg.walletTrade.amountSats);
    const coins = (await raw.getUtxos(address)).filter((u) => !u.token);
    if (!coins.some((u) => u.vout === 0 && u.satoshis >= need)) {
      const txid = await fundWallet(gated, [as('seller'), as('arbitrator')], address, BigInt(tp.fundSats),
        cfg.mainnet.feeRateSatsPerByte);
      log(`funded the third-party wallet with ${tp.fundSats} sat: ${txid}`);
      for (let i = 0; i < 30 && !(await raw.getUtxos(address)).some((u) => u.txid === txid); i++) await wallet.waitForTimeout(2_000);
    }
    await site.getByTestId('wallet-create').click();
    await signUntil(wallet, site, site.getByTestId('wallet-fund'), 'create');
    const escrow = await site.getByTestId('escrow-address').innerText();
    log(`escrow ${escrow}`);
    await site.getByTestId('wallet-fund').click();
    await signUntil(wallet, site, site.getByTestId('wallet-refresh'), 'fund');
    const sc = await attachEscrow(gated, escrow, keysFrom({ seller: roleKey, buyer: binToHex(keys.buyer?.publicKey ?? new Uint8Array()),
      panel: cfg.walletTrade.panel, feeRecipientPkh: cfg.walletTrade.feeRecipientPkh }));
    const paid = await buyerMarksPaid(sc, as('buyer'));
    log(`buyer marked paid: ${paid}`);
    const release = site.getByTestId('wallet-release');
    for (let i = 0; i < 20 && !(await release.isEnabled()); i++) {
      await site.waitForTimeout(6_000);
      await site.getByTestId('wallet-refresh').click();
    }
    await release.click();
    await signUntil(wallet, site, site.locator('[data-testid="wallet-txs"] li[data-step="release"]'), 'release');
    await site.waitForTimeout(1_500);
    await site.screenshot({ path: join(SHOTS, 'jamin-x-site-released.png'), fullPage: true });
    const txid = async (step: string): Promise<string> =>
      site.locator(`[data-testid="wallet-txs"] li[data-step="${step}"] a`).innerText();
    const steps = branchXSteps(tp.branch, escrow, tp.name,
      { createEscrow: await txid('createEscrow'), fund: await txid('fund'), release: await txid('release') }, paid);
    const measured = [];
    for (const st of steps) measured.push(await measure(raw, st));
    const outDir = join(repoRoot, cfg.mainnet.outputDir);
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `x-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, `${JSON.stringify({ escrow, wallet: tp.name, walletAddress: address, roleKey, steps: measured }, null, 2)}\n`);
    const file = join(repoRoot, cfg.mainnetExamples);
    writeRecord(file, addSteps(readRecord(file), measured));
    for (const m of measured) log(`${m.step.padEnd(13)} ${m.txid} ${m.txBytes} B fee ${m.feeSats ?? '?'} sat`);
    log(`wrote ${out} and ${cfg.mainnetExamples}`);
  }
} finally {
  await browser.close();
  await electrum.disconnect();
  server.close();
}
process.exit(process.exitCode ?? 0);
