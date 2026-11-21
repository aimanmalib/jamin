/// <reference lib="dom" />
// The "Release on mainnet" card (docs/decisions/0020-public-demo-escrow.md), opened from the Home hero (0024). The live button is never pressed here:
// mock mode stages a demo escrow on the mock network in the page and releases it there; on mainnet only dry mode,
// which signs and sends nothing, is pressed.
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';
import mainnet from '../examples/mainnet.json' with { type: 'json' };

const staged = (mainnet.escrows as { demo?: boolean }[]).some((e) => e.demo === true);

const releases = (mainnet as unknown as { escrows: { steps: { step: string; refused?: boolean }[] }[] }).escrows
  .flatMap((e) => e.steps).filter((s) => s.step === 'release' && s.refused !== true).length;

test('demo card on the mock network: staged, released in the page, fits 320 px', async ({ page }) => {
  const errors = watchErrors(page);
  // The pool's list as the host cron writes it: it ran just now, every 10 minutes, and can still stage.
  await page.route('**/pool/pool.json', (route) => route.fulfill({ json: { updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(), everyMinutes: 10, closed: false, escrows: [] } }));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?demo=mock&stats=mock#/');
  await expect(page.getByTestId('stats-releases')).toHaveText(String(releases));
  await page.getByTestId('hero-release').click();
  const card = page.getByTestId('demo-release');
  await card.scrollIntoViewIfNeeded();
  const button = card.getByRole('button', { name: 'Release on mainnet' });
  await expect(button).toBeVisible({ timeout: 170_000 });
  await noHorizontalOverflow(page);
  await button.click();
  await expect(card.getByTestId('demo-result')).toContainText('Released.', { timeout: 120_000 });
  await expect(card.getByTestId('demo-result').locator('.txid')).toHaveText(/^[0-9a-f]{64}$/);
  // No other escrow waits: the card counts the minutes to the next staging, and the strip counts the release at once.
  await expect(card.getByTestId('demo-pool-next')).toHaveText(
    /^All demo escrows were released\. The next one is being prepared: ready in about 1[12] min\.$/);
  await expect(page.getByTestId('stats-releases')).toHaveText(String(releases + 1));
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('demo card when the pool waits for its wallet to be restocked: says so, asks for nothing, fits 320 px',
  async ({ page }) => {
    const errors = watchErrors(page);
    // The pool's list as the cron writes it while the demo wallet is too short to stage (decision 0021).
    await page.route('**/pool/pool.json', (route) => route.fulfill({ json: { updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(), everyMinutes: 10, closed: true, closedReason: 'funds', escrows: [] } }));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/?demo=mock#/');
    await page.getByTestId('hero-release').click();
    const card = page.getByTestId('demo-release');
    await card.scrollIntoViewIfNeeded();
    const button = card.getByRole('button', { name: 'Release on mainnet' });
    await expect(button).toBeVisible({ timeout: 170_000 });
    await button.click();
    await expect(card.getByTestId('demo-result')).toContainText('Released.', { timeout: 120_000 });
    const line = card.getByTestId('demo-pool-next');
    await expect(line).toHaveText("The next demo escrow will be staged when the project's demo wallet is restocked. "
      + 'The recorded mainnet releases are in Lifecycle.');
    await expect(line).not.toContainText(/bitcoincash:|send/i);
    await noHorizontalOverflow(page);
    // WebKit logs a CSP refusal for the style Playwright injects while taking a screenshot (strict style-src).
    const before = errors.length;
    await line.screenshot({ path: test.info().outputPath('demo-restock.png') });
    errors.splice(before);
    expect(errors).toEqual([]);
  });

test('demo card on mainnet: dry mode signs without sending, or says the escrow is not staged yet', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?demo=dry#/');
  await page.getByTestId('hero-release').click();
  const card = page.getByTestId('demo-release');
  await card.scrollIntoViewIfNeeded();
  if (!staged) {
    await expect(card.getByTestId('demo-none')).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
  } else {
    const dry = card.getByRole('button', { name: 'Sign the release without sending' });
    const closed = card.getByTestId('demo-closed');
    await expect(dry.or(closed)).toBeVisible({ timeout: 120_000 });
    if (await dry.isVisible()) {
      await dry.click();
      await expect(card.getByTestId('demo-result')).toContainText('Signed, not sent', { timeout: 120_000 });
    }
  }
  expect(errors).toEqual([]);
});

test('demo card in Malay', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await page.getByTestId('hero-release').click();
  await expect(page.getByTestId('demo-release').getByRole('heading')).toHaveText('Lepaskan di mainnet');
});
