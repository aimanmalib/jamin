/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';

/** Chromium's note that the test host's network interfaces changed (containers of other services starting and
 * stopping on a shared host): about the machine running the test, not the page. Only this exact message is ignored. */
const HOST_NETWORK_CHANGED = 'Failed to load resource: net::ERR_NETWORK_CHANGED';

/** Collects console errors and uncaught page errors for the rest of the test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && m.text() !== HOST_NETWORK_CHANGED) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, 'page wider than the viewport').toBeLessThanOrEqual(client);
}

export async function startTrade(page: Page, asset: 'bch' | 'token', seller: 'key' | 'wallet' = 'key'): Promise<void> {
  await page.goto('/#/try');
  await page.locator(`input[name="asset"][value="${asset}"]`).check({ force: true });
  await page.locator(`input[name="seller"][value="${seller}"]`).check({ force: true });
  await page.getByRole('button', { name: /^Start a trade$|^Start again$/ }).click();
  await expect(page.getByTestId('status')).toHaveText('Coins locked');
}

/** Picks `role` and presses `action`; waits for the new log entry. */
export async function act(page: Page, role: string, action: string): Promise<void> {
  const before = await page.getByTestId('log-entry').count();
  await page.locator(`input[name="actor"][value="${role}"]`).check({ force: true });
  await page.locator(`button[data-action="${action}"]`).click();
  await expect(page.getByTestId('log-entry')).toHaveCount(before + 1);
}

/** The newest log entry. */
export function latest(page: Page): ReturnType<Page['getByTestId']> {
  return page.getByTestId('log-entry').first();
}
