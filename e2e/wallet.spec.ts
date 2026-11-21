// The Wallet tab with the stand-in wallet of `?wallet=mock` (no relay, nothing signed or sent): the WizardConnect link
// as a QR code that copies on tap, the header chip that turns into the wallet's balance, and the escrow status that
// moves from funded to paid with no click (docs/decisions/0022). The stand-in's coins sit at several addresses and the
// balance shown is their sum; `?wallet=mock-empty` is a wallet with none, which gets a plain empty state and the
// simulator, never a request to send coins to the page (decision 0027).
import { expect, test } from '@playwright/test';
import config from '../config/jamin.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
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
  // 100 000 sat at receive/24 plus 23 456 sat at change/2: the sum, not the first address's (empty) balance.
  await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');
  await expect(page.getByTestId('wallet-balance')).toContainText('0.00123456 BCH');
  await expect(page.getByTestId('wallet-balance')).toContainText('found over 2 of the');
  await expect(page.getByTestId('wallet-address')).toBeVisible();
  await expect(page.getByText('Address in your wallet that pays the next step:')).toBeVisible();
  await expect(page.getByTestId('wallet-empty')).toHaveCount(0);
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

test('wallet: an empty wallet gets a plain empty state and the demo, never a request for coins', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?wallet=mock-empty#/wallet');
  await page.getByTestId('buyer-key').fill(BUYER);
  await page.getByTestId('wallet-connect').click();
  await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
  const empty = page.getByTestId('wallet-empty');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('heading')).toHaveText(en.wallet.noCoins);
  await expect(page.getByTestId('wallet-try-demo')).toHaveText(en.wallet.tryDemo);
  await expect(empty).toContainText('We checked 40 receive and change addresses of Mock wallet');
  await expect(page.getByTestId('header-balance')).toHaveText('0.00 BCH');
  await expect(page.getByTestId('wallet-create')).toBeDisabled();
  const text = (await page.locator('main').textContent()) ?? '';
  expect(text).not.toMatch(/send [^.]*to (this|the) (page|site)|deposit address/i);
  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
  await noHorizontalOverflow(page);
  await page.getByTestId('wallet-try-demo').click();
  await expect(page).toHaveURL(/#\/try/);
  await expect(page.getByRole('button', { name: /^Start a trade$/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('wallet: the empty state fits 320 px in Malay', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?wallet=mock-empty#/wallet');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await page.getByTestId('buyer-key').fill(BUYER);
  await page.getByTestId('wallet-connect').click();
  await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
  await expect(page.getByTestId('wallet-try-demo')).toHaveText(ms.wallet.tryDemo);
  await page.getByTestId('wallet-empty').scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  const box = await page.getByTestId('wallet-try-demo').boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});

type Drop = 'ended' | 'reconnect' | 'back';
const drop = async (page: import('@playwright/test').Page, kind: Drop): Promise<void> => {
  await page.evaluate((k) => {
    (window as unknown as { jaminWalletMock: { drop(kind: Drop): void } }).jaminWalletMock.drop(k);
  }, kind);
};

test('wallet: a dropped connection pauses the buttons, an ended session is noticed and Connect again continues',
  async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('/?wallet=mock#/wallet');
    await page.getByTestId('buyer-key').fill(BUYER);
    await page.getByTestId('wallet-connect').click();
    await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
    await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');
    const tradeName = (await page.getByTestId('trade-name').textContent()) ?? '';
    const roleKey = (await page.getByTestId('role-key').textContent()) ?? '';
    await page.getByTestId('wallet-create').click();
    await page.getByTestId('wallet-fund').click();
    await expect(page.getByTestId('wallet-status')).toHaveAttribute('data-status', 'funded');

    // The relay drops: "Reconnecting..." in the chip and the tab, the buttons wait; the wallet comes back.
    await drop(page, 'reconnect');
    await expect(page.getByTestId('header-wallet')).toHaveText(en.wallet.reconnecting);
    await expect(page.getByTestId('wallet-reconnecting')).toContainText(en.wallet.reconnectingDetail);
    await expect(page.getByTestId('wallet-release')).toBeDisabled();
    await drop(page, 'back');
    await expect(page.getByTestId('wallet-reconnecting')).toHaveCount(0);
    await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');

    // The wallet ends the session: the chip is back to "Connect wallet", the tab says so, the escrow stays shown.
    await drop(page, 'ended');
    await expect(page.getByTestId('header-wallet')).toHaveText('Connect wallet');
    const ended = page.getByTestId('wallet-ended');
    await expect(ended).toContainText(en.wallet.ended);
    await expect(ended).toContainText(en.wallet.endedDetail);
    await expect(page.getByTestId('wallet-connected')).toHaveCount(0);
    await expect(page.getByTestId('wallet-release')).toHaveCount(0);
    await expect(page.getByTestId('escrow-address')).toBeVisible();
    await page.screenshot({ path: info.outputPath('wallet-ended.png') });

    // Connect again: a new session for the same trade name, so the same seller key, and the escrow continues.
    await page.getByTestId('wallet-connect-again').click();
    await expect(page.getByTestId('wallet-link-box')).toBeVisible();
    await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
    await expect(page.getByTestId('wallet-ended')).toHaveCount(0);
    await expect(page.getByTestId('trade-name')).toHaveText(tradeName);
    await expect(page.getByTestId('role-key')).toHaveText(roleKey);
    await expect(page.getByTestId('header-balance')).toHaveText('0.00123456 BCH');
    await expect(page.getByTestId('wallet-status')).toHaveAttribute('data-status', 'paid',
      { timeout: config.walletTrade.pollMs * 5 });
    await expect(page.getByTestId('wallet-release')).toBeEnabled();
    expect(errors).toEqual([]);
  });

test('wallet: &drop=ended shows the ended session in Malay and fits 320 px', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?wallet=mock&drop=reconnect#/wallet');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await page.getByTestId('buyer-key').fill(BUYER);
  await page.getByTestId('wallet-connect').click();
  await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
  await expect(page.getByTestId('header-wallet')).toHaveText(ms.wallet.reconnecting);
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await noHorizontalOverflow(page);
  const [chip, lang] = [await page.getByTestId('header-wallet').boundingBox(),
    await page.locator('.btn-lang').boundingBox()];
  expect((chip?.x ?? 0) + (chip?.width ?? 0)).toBeLessThanOrEqual(320);
  expect((lang?.x ?? 0) + (lang?.width ?? 0)).toBeLessThanOrEqual(320);
  // The reconnecting chip stays on the brand's row, as the other chip states do.
  const brand = await page.locator('.brand').boundingBox();
  expect(Math.abs((chip?.y ?? 0) + (chip?.height ?? 0) / 2 - (brand?.y ?? 0) - (brand?.height ?? 0) / 2)).toBeLessThan(8);
  await page.screenshot({ path: info.outputPath('wallet-reconnecting-320.png') });

  await page.goto('/?wallet=mock&drop=ended#/wallet');
  await page.getByTestId('buyer-key').fill(BUYER);
  await page.getByTestId('wallet-connect').click();
  await page.evaluate(() => { (window as unknown as { jaminWalletMock: { accept(): void } }).jaminWalletMock.accept(); });
  const ended = page.getByTestId('wallet-ended');
  await expect(ended).toContainText(ms.wallet.ended);
  await expect(page.getByTestId('wallet-connect-again')).toHaveText(ms.wallet.connectAgain);
  await expect(page.getByTestId('header-wallet')).toHaveText(ms.wallet.connectShort);
  const text = (await page.locator('main').textContent()) ?? '';
  expect(text).not.toMatch(/hantar [^.]*ke (laman|halaman)|alamat deposit/i);
  await ended.scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  const box = await page.getByTestId('wallet-connect-again').boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath('wallet-ended-320.png') });
});
