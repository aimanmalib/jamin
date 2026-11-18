/// <reference lib="dom" />
// The first screen, language toggle, accessibility, the recorded runs, the contract view and narrow screens.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';
import regtest from '../examples/regtest.json' with { type: 'json' };
import mainnet from '../examples/mainnet.json' with { type: 'json' };
import config from '../config/jamin.json' with { type: 'json' };

const TABS = ['/#/', '/#/try', '/#/lifecycle', '/#/contract'];

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
  const refused = [...(regtest.refused?.steps ?? []), ...mainnet.escrows.flatMap((e) => e.steps)]
    .filter((s) => 'refused' in s && s.refused);
  expect(refused.length).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/lifecycle');
  await expect(page.getByTestId('refused-step')).toHaveCount(refused.length);
  for (const s of refused as Array<{ serverError: string; rawTxHash: string }>) {
    await expect(page.getByTestId('server-error').filter({ hasText: s.serverError })).toHaveCount(1);
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
