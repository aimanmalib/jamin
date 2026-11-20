/// <reference lib="dom" />
// The Home hero (decision 0024): "Release on mainnet" above the fold on an iPhone 13 and a 1280 x 800 desktop, the
// simulator as the second button, a small animation that holds still with reduced motion, nothing wider than 320 px.
// Only dry mode is pressed here: the live demo escrow is never released by a test.
import { expect, test, type Page } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';

const FOLD = 664;

// SHOT_DIR (optional): a folder for evidence screenshots.
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/jamin-q4-${test.info().project.name}-${name}.png` });
}

test('hero: Release on mainnet above the fold, the simulator second, dry release from the pool', async ({ page }) => {
  const errors = watchErrors(page);
  if (test.info().project.name === 'chromium') await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?demo=dry#/');
  const release = page.getByTestId('hero-release');
  await expect(release).toHaveText('Release on mainnet');
  await expect(release).toHaveClass(/btn-primary/);
  const box = await release.boundingBox();
  expect(box && box.y + box.height, 'Release button bottom').toBeLessThanOrEqual(FOLD);
  const tryIt = page.getByTestId('hero-try');
  await expect(tryIt).toHaveText('Try the simulator');
  await expect(tryIt).toHaveAttribute('href', '#/try');
  const tryBox = await tryIt.boundingBox();
  expect(tryBox && box && tryBox.y + 1 >= box.y, 'simulator after Release').toBe(true);
  expect(await page.locator('.hero-art').evaluate((el) => el.outerHTML.length)).toBeLessThanOrEqual(8192);
  await shot(page, 'before');
  await release.click();
  const card = page.getByTestId('demo-release');
  await expect(card).toBeFocused();
  await expect(release).toHaveCount(0);
  const dry = card.getByRole('button', { name: 'Sign the release without sending' });
  const other = card.getByTestId('demo-closed').or(card.getByTestId('demo-none'));
  await expect(dry.or(other)).toBeVisible({ timeout: 120_000 });
  await shot(page, 'after');
  expect(errors.filter((e) => !e.includes('Refused to apply'))).toEqual([]);
});

test('hero: holds still with reduced motion, moves without', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/');
  const coin = page.locator('.hero-coin');
  expect(await coin.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await coin.evaluate((el) => getComputedStyle(el).animationName)).toBe('hero-coin');
});

test('hero: no horizontal overflow at 320 px, also with the demo card open', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?demo=dry#/');
  await noHorizontalOverflow(page);
  await page.getByTestId('hero-release').click();
  await expect(page.getByTestId('demo-release')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await noHorizontalOverflow(page);
});

test('hero in Malay', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.getByTestId('hero-release')).toHaveText('Lepaskan di mainnet');
  await expect(page.getByTestId('hero-try')).toHaveText('Cuba simulator');
});
