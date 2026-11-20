/// <reference lib="dom" />
// Home stats strip (decision 0023): the recorded numbers come from examples/mainnet.json, and with `?stats=mock` the
// block height moves on by itself (no click) while "updated N s ago" counts. Fits 320 px, both languages.
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';
import mainnet from '../examples/mainnet.json' with { type: 'json' };
import config from '../config/jamin.json' with { type: 'json' };

const escrows = mainnet.escrows.length;
const steps = (mainnet as unknown as { escrows: { steps: { refused?: boolean }[] }[] }).escrows.flatMap((e) => e.steps);
const refused = steps.filter((s) => s.refused === true).length;
const start = config.stats.mockStartHeight;

test('stats strip: recorded numbers, and the block moves on without a click', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?stats=mock&demo=dry');
  const strip = page.getByRole('region', { name: 'On mainnet', exact: true });
  await expect(strip).toBeVisible();
  // The pool list may name escrows the file does not record yet: never fewer than the file.
  expect(Number((await page.getByTestId('stats-escrows').textContent())?.replace(/\D/g, ''))).toBeGreaterThanOrEqual(escrows);
  await expect(page.getByTestId('stats-refused')).toHaveText(String(refused));
  await expect(page.getByTestId('stats-locked')).toHaveText(/^0\.\d{8} BCH$/);
  await expect(page.getByTestId('stats-locked-token')).toHaveText(/PUSD/);
  await expect(page.getByTestId('stats-block')).toHaveText(/\d/);
  const first = Number((await page.getByTestId('stats-block').textContent())?.replace(/\D/g, ''));
  expect(first).toBeGreaterThanOrEqual(start);
  await expect.poll(async () => Number((await page.getByTestId('stats-block').textContent())?.replace(/\D/g, '')),
    { timeout: 15_000 }).toBeGreaterThan(first);
  await expect(page.getByTestId('stats-age')).toHaveText(/^updated \d+ s ago$/);
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.getByRole('region', { name: 'Di mainnet', exact: true })).toBeVisible();
  await expect(page.getByTestId('stats-age')).toHaveText(/^dikemas kini \d+ s lalu$/);
  expect(errors).toEqual([]);
});

test('stats strip: no horizontal overflow at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?stats=mock&demo=dry');
  await page.getByRole('region', { name: 'On mainnet', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId('stats-block')).toHaveText(/\d/);
  await noHorizontalOverflow(page);
  const box = await page.getByRole('region', { name: 'On mainnet', exact: true }).boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});
