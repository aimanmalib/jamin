/// <reference lib="dom" />
// The first screen, language toggle, accessibility, the recorded runs, the contract view and narrow screens.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';
import regtest from '../examples/regtest.json' with { type: 'json' };
import mainnet from '../examples/mainnet.json' with { type: 'json' };
import config from '../config/jamin.json' with { type: 'json' };

const TABS = ['/#/', '/#/try', '/#/wallet', '/#/lifecycle', '/#/contract'];

test('home: one sentence, one primary button, the banner, no console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.btn-primary')).toHaveCount(1);
  await expect(page.locator('.btn-primary')).toBeInViewport();
  await expect(page.getByLabel(config.banner.prizeAddress)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source code' }).first()).toHaveAttribute('href', config.banner.repoUrl);
  await expect(page.getByRole('link', { name: 'Slides' })).toHaveAttribute('href', config.banner.deckUrl);
  expect(errors).toEqual([]);
});

test('home: the demo video loads only on play, answers range requests, and fits 320 px', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const path = new URL(config.banner.videoUrl).pathname;
  await expect(page.getByRole('link', { name: 'Demo video' })).toHaveAttribute('href', config.banner.videoUrl);
  const video = page.locator('.demo-video video');
  await video.scrollIntoViewIfNeeded();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveAttribute('poster', new URL(config.banner.videoPosterUrl).pathname);
  await expect(video.locator('source')).toHaveAttribute('src', path);
  const range = await page.request.get(path, { headers: { Range: 'bytes=0-1' } });
  expect(range.status()).toBe(206);
  expect(range.headers()['content-type']).toBe('video/mp4');
  const poster = await page.request.get(new URL(config.banner.videoPosterUrl).pathname);
  expect(poster.status()).toBe(200);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('language toggle switches to Malay and is remembered', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ms');
  await expect(page.getByRole('link', { name: 'Mula dagangan' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
});

test('no serious accessibility violations on any tab', async ({ page }) => {
  for (const path of TABS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${path} ${v.id}`)).toEqual([]);
  }
});

test('lifecycle: lists every mainnet escrow with its txids, and the regtest run', async ({ page }) => {
  await page.goto('/#/lifecycle');
  if (mainnet.escrows.length === 0) await expect(page.getByTestId('mainnet-empty')).toBeVisible();
  else await expect(page.getByTestId('mainnet-lede')).toBeVisible();
  for (const e of mainnet.escrows) {
    for (const s of e.steps) {
      if ('txid' in s) await expect(page.getByRole('link', { name: s.txid, exact: true })).toHaveCount(1);
    }
  }
  for (const tx of regtest.transactions) await expect(page.getByText(tx.txid)).toHaveCount(1);
});

test('lifecycle: calls the network refused show the rejection text verbatim, in both languages', async ({ page }) => {
  const steps: object[] = [...(regtest.refused?.steps ?? []), ...mainnet.escrows.flatMap((e): object[] => [...e.steps])];
  const refused = steps.filter((s) => 'refused' in s && s.refused === true);
  expect(refused.length).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/lifecycle');
  await expect(page.getByTestId('refused-step')).toHaveCount(refused.length);
  // One node's reason can be part of a server's longer text (mainnet adds Fulcrum's first line): count every text
  // that contains it.
  const texts = (refused as Array<{ serverError: string }>).map((s) => s.serverError.replace(/\s+/g, ' ').trim());
  for (const s of refused as Array<{ serverError: string; rawTxHash: string }>) {
    const text = s.serverError.replace(/\s+/g, ' ').trim();
    await expect(page.getByTestId('server-error').filter({ hasText: text }))
      .toHaveCount(texts.filter((t) => t.includes(text)).length);
    await expect(page.getByText(s.rawTxHash, { exact: true })).toHaveCount(1);
  }
  await page.getByTestId('regtest-refused').scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.getByText('Ditolak oleh rangkaian')).toHaveCount(refused.length);
});

test('contract: a feature reference highlights its source line', async ({ page }) => {
  await page.goto('/#/contract');
  const ref = page.locator('button.ref').first();
  const [file, line] = (await ref.innerText()).split(':');
  await ref.click();
  await expect(page.locator('pre.source')).toHaveAttribute('aria-label', file ?? '');
  await expect(page.locator(`#L${line}`)).toHaveClass(/hit/);
  // SDK rows name code outside contracts/: plain text, not links into the contract source viewer.
  await expect(page.locator('code.ref-code', { hasText: 'src/lifecycle/wallet-branch.ts:' })).toBeVisible();
  await expect(page.locator('button.ref', { hasText: 'src/' })).toHaveCount(0);
});

test('320 px wide: no horizontal overflow on any tab, also after scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of TABS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await noHorizontalOverflow(page);
  }
  await page.goto('/#/try');
  await page.getByRole('button', { name: 'Start a trade' }).click();
  await expect(page.getByTestId('status')).toBeVisible();
  await noHorizontalOverflow(page);
});

test('wallet: the connect button waits for a valid buyer key, in English and Malay, at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/wallet');
  await expect(page.getByRole('heading', { level: 1, name: 'Trade from your wallet' })).toBeVisible();
  const connect = page.getByTestId('wallet-connect');
  await expect(connect).toBeDisabled();
  await page.getByTestId('buyer-key').fill('02abc');
  await expect(page.getByTestId('buyer-key')).toHaveAttribute('aria-invalid', 'true');
  await expect(connect).toBeDisabled();
  await page.getByTestId('buyer-key').fill(`02${'ab'.repeat(32)}`);
  await expect(connect).toBeEnabled();
  await expect(page.getByTestId('wallet-terms')).toContainText(config.walletTrade.amountSats.toLocaleString('en'));
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Berdagang dari dompet anda' })).toBeVisible();
  await expect(page.getByTestId('wallet-connect')).toHaveText('Sambung dompet');
});

test('wallet: a continue link fills the trade and the buyer key', async ({ page }) => {
  const escrow = `bitcoincash:p${'q'.repeat(60)}`;
  await page.goto(`/#/wallet?trade=wallet-1&escrow=${escrow}&buyer=02${'cd'.repeat(32)}`);
  await expect(page.getByTestId('wallet-resume')).toContainText('wallet-1');
  await expect(page.getByTestId('buyer-key')).toHaveValue(`02${'cd'.repeat(32)}`);
  await expect(page.getByTestId('wallet-connect')).toBeEnabled();
});
