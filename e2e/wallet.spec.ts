// The Wallet tab with the stand-in wallet of `?wallet=mock` (no relay, nothing signed or sent): the WizardConnect link
// as a QR code that copies on tap, the header chip that turns into the wallet's balance, and the escrow status that
// moves from funded to paid with no click (docs/decisions/0022).
import { expect, test } from '@playwright/test';
import config from '../config/jamin.json' with { type: 'json' };
import { noHorizontalOverflow, watchErrors } from './helpers.js';

const BUYER = `02${'ab'.repeat(32)}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { copiedText: string[] };
    w.copiedText = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (t: string) => { w.copiedText.push(t); return Promise.resolve(); } } });
  });
});

test('wallet: QR with the hat, tap to copy, balance chip in the header, funded turns paid by itself', async ({ page },
  info) => {
  const errors = watchErrors(page);
  // WebKit logs a CSP refusal for the style Playwright injects while taking a screenshot on the public site (strict
  // style-src); drop only what is logged during the test's own screenshots.
  const shot = async (name: string): Promise<void> => {
    const before = errors.length;
    await page.screenshot({ path: info.outputPath(name), fullPage: false });
    errors.splice(before);
  };
  await page.goto('/?wallet=mock#/');
  const chip = page.getByTestId('header-wallet');
  await expect(chip).toHaveText('Connect wallet');
  await expect(chip.locator('svg.wizard-hat')).toHaveCount(1);
  // Top right, on the brand's row: the chip adds no header row on a phone.
  const [brandBox, chipBox] = [await page.locator('.brand').boundingBox(), await chip.boundingBox()];
  expect(Math.abs((chipBox?.y ?? 0) + (chipBox?.height ?? 0) / 2 - (brandBox?.y ?? 0) - (brandBox?.height ?? 0) / 2))
    .toBeLessThan(8);
  await chip.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Trade from your wallet' })).toBeVisible();
  await page.getByTestId('buyer-key').fill(BUYER);
  await page.getByTestId('wallet-connect').click();

  const box = page.getByTestId('wallet-link-box');
  await expect(box).toContainText('WizardConnect');
  const qr = page.getByTestId('wallet-qr');
  await expect(qr).toBeVisible();
  const link = (await page.getByTestId('wallet-link').textContent()) ?? '';
  expect(link).toMatch(/^wiz:\/\//);
  await qr.click();
  await expect(page.getByTestId('wallet-copied')).toHaveText('Copied');
  await expect(page.getByTestId('wallet-copied')).toHaveText('', { timeout: config.walletTrade.copiedMs + 5000 });
  await page.getByTestId('wallet-copy').click();
  await expect(page.getByTestId('wallet-copied')).toHaveText('Copied');
  expect(await page.evaluate(() => (window as unknown as { copiedText: string[] }).copiedText)).toEqual([link, link]);
  await noHorizontalOverflow(page);
  await shot('wallet-qr.png');

  await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
  await expect(page.getByTestId('wallet-connected')).toBeVisible();
  await expect(page.getByTestId('wallet-link-box')).toHaveCount(0);
  await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');
  // The token count is hidden on phones to keep the header on one row; it is in the page either way.
  await expect(page.getByTestId('header-token')).toHaveText(`2.50 ${config.tokens.pusd.symbol}`);
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await shot('wallet-chip.png');

  await page.getByTestId('wallet-create').click();
  await page.getByTestId('wallet-fund').click();
  await expect(page.getByTestId('wallet-status')).toHaveAttribute('data-status', 'funded');
  await expect(page.getByTestId('wallet-release')).toBeDisabled();
  await expect(page.getByTestId('wallet-refresh')).toHaveCount(0);
  await expect(page.getByTestId('wallet-status')).toHaveAttribute('data-status', 'paid',
    { timeout: config.walletTrade.pollMs * 5 });
  await expect(page.getByTestId('wallet-release')).toBeEnabled();
  await shot('wallet-paid.png');

  // The chip and the trade stay when the visitor looks at another tab and comes back.
  await page.locator('.tabs a[href="#/try"]').click();
  await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');
  await page.getByTestId('header-wallet').click();
  await expect(page.getByTestId('wallet-status')).toHaveAttribute('data-status', 'paid');
  await page.getByTestId('wallet-release').click();
  await expect(page.getByTestId('wallet-status')).toHaveAttribute('data-status', 'released');
  expect(errors).toEqual([]);
});

test('wallet: the QR box, the header chip and Malay text fit 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?wallet=mock#/wallet');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.getByTestId('header-wallet')).toHaveText('Sambung dompet');
  await expect(page.getByRole('link', { name: 'Sambung dompet' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByTestId('buyer-key').fill(BUYER);
  await page.getByTestId('wallet-connect').click();
  await expect(page.getByTestId('wallet-qr')).toBeVisible();
  await page.getByTestId('wallet-copy').click();
  await expect(page.getByTestId('wallet-copied')).toHaveText('Disalin');
  await noHorizontalOverflow(page);
  await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
  await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');
  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
  await noHorizontalOverflow(page);
});
