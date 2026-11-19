/// <reference lib="dom" />
// The "Release on mainnet" card (docs/decisions/0020-public-demo-escrow.md). The live button is never pressed here:
// mock mode stages a demo escrow on the mock network in the page and releases it there; on mainnet only dry mode,
// which signs and sends nothing, is pressed.
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';
import mainnet from '../examples/mainnet.json' with { type: 'json' };

const staged = (mainnet.escrows as { demo?: boolean }[]).some((e) => e.demo === true);

test('demo card on the mock network: staged, released in the page, fits 320 px', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?demo=mock#/');
  const card = page.getByTestId('demo-release');
  await card.scrollIntoViewIfNeeded();
  const button = card.getByRole('button', { name: 'Release on mainnet' });
  await expect(button).toBeVisible({ timeout: 170_000 });
  await noHorizontalOverflow(page);
  await button.click();
  await expect(card.getByTestId('demo-result')).toContainText('Released.', { timeout: 120_000 });
  await expect(card.getByTestId('demo-result').locator('.txid')).toHaveText(/^[0-9a-f]{64}$/);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('demo card on mainnet: dry mode signs without sending, or says the escrow is not staged yet', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?demo=dry#/');
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
  await expect(page.getByTestId('demo-release').getByRole('heading')).toHaveText('Lepaskan di mainnet');
});
