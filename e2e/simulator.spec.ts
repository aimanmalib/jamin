// The five lifecycle branches, played through the browser simulator on the real compiled contracts.
import { expect, test } from '@playwright/test';
import { act, latest, noHorizontalOverflow, startTrade, watchErrors } from './helpers.js';

test.describe('simulator', () => {
  test('A: BCH release, with a named rejection for the wrong role', async ({ page }) => {
    const errors = watchErrors(page);
    await startTrade(page, 'bch');
    await act(page, 'seller', 'markAsPaid');
    await expect(latest(page)).toHaveAttribute('data-ok', 'false');
    await expect(latest(page).getByTestId('error-name')).toHaveText('NotBuyer');
    await expect(page.getByTestId('last-result')).toContainText('NotBuyer');
    await expect(page.getByTestId('last-result')).toBeInViewport();
    await act(page, 'buyer', 'markAsPaid');
    await expect(page.getByTestId('status')).toHaveText('Marked as paid');
    await act(page, 'seller', 'release');
    await expect(page.getByTestId('status')).toHaveText('Released to buyer');
    expect(errors).toEqual([]);
  });

  test('B: token release', async ({ page }) => {
    await startTrade(page, 'token');
    await act(page, 'buyer', 'markAsPaid');
    await act(page, 'seller', 'release');
    await expect(page.getByTestId('status')).toHaveText('Released to buyer');
  });

  test('C: buyer cancels', async ({ page }) => {
    await startTrade(page, 'bch');
    await act(page, 'buyer', 'buyerCancel');
    await expect(page.getByTestId('status')).toHaveText('Cancelled by buyer');
  });

  test('D: seller cancels only after the waiting time', async ({ page }) => {
    await startTrade(page, 'bch');
    await act(page, 'seller', 'sellerCancel');
    await expect(latest(page).getByTestId('error-name')).toHaveText('TooEarly');
    await act(page, 'seller', 'wait');
    await act(page, 'seller', 'sellerCancel');
    await expect(page.getByTestId('status')).toHaveText('Cancelled by seller');
  });

  test('E: dispute decided by two of the three panel members', async ({ page }) => {
    await startTrade(page, 'bch');
    await act(page, 'buyer', 'markAsPaid');
    await act(page, 'buyer', 'openDispute');
    await expect(page.getByTestId('status')).toHaveText('In dispute');
    await act(page, 'buyer', 'resolveForBuyer');
    await expect(latest(page).getByTestId('error-name')).toHaveText('NotArbitrator');
    await expect(page.locator('input[name="cosign"]')).toHaveCount(0);
    await page.locator('input[name="actor"][value="arbitrator"]').check({ force: true });
    await page.locator('input[name="cosign"][value="none"]').check({ force: true });
    await act(page, 'arbitrator', 'resolveForBuyer');
    await expect(latest(page).getByTestId('error-name')).toHaveText('NotArbitrator');
    await expect(latest(page).getByTestId('signatures')).toHaveText('Signatures: panel member A, panel member A');
    await expect(page.getByTestId('status')).toHaveText('In dispute');
    await page.locator('input[name="cosign"][value="B"]').check({ force: true });
    await act(page, 'arbitrator', 'resolveForBuyer');
    await expect(latest(page).getByTestId('signatures')).toHaveText('Signatures: panel member A, panel member B');
    await expect(page.getByTestId('status')).toHaveText('Dispute resolved');
  });

  test('E in Malay: the panel choice and the signatures are translated', async ({ page }) => {
    await startTrade(page, 'bch');
    await act(page, 'buyer', 'markAsPaid');
    await act(page, 'buyer', 'openDispute');
    await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
    await page.locator('input[name="actor"][value="arbitrator"]').check({ force: true });
    await expect(page.getByText('Tandatangan panel')).toBeVisible();
    await page.locator('input[name="cosign"][value="none"]').check({ force: true });
    await act(page, 'arbitrator', 'resolveForSeller');
    await expect(latest(page).getByTestId('signatures')).toHaveText('Tandatangan: ahli panel A, ahli panel A');
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await noHorizontalOverflow(page);
  });
});
