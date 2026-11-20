/// <reference lib="dom" />
// Home depth strip (decision 0026): the numbers the page shows are the ones web/data/depth.ts counts from the
// repository files, the in-site links open their tabs, the strip sits in the first screen on a 1280x800 desktop and
// by the second screen on a phone, and it fits 320 px in both languages.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, watchErrors } from './helpers.js';
import mainnet from '../examples/mainnet.json' with { type: 'json' };
import config from '../config/jamin.json' with { type: 'json' };
import testCases from '../artifacts/solidhat-tests.json' with { type: 'json' };
import { depth } from '../web/data/depth.js';
import type { MainnetRun } from '../web/data/examples.js';

const d = depth({ featuresMd: readFileSync('docs/FEATURES.md', 'utf8'), testCases,
  findingsMd: readFileSync('docs/SOLIDCASH-FINDINGS.md', 'utf8'), upstreamPrs: config.depth.upstreamPrs,
  run: mainnet as unknown as MainnetRun });
const num = async (page: import('@playwright/test').Page, id: string): Promise<number> =>
  Number((await page.getByTestId(id).locator('.depth-n').textContent())?.replace(/\D/g, ''));

test('depth strip: counted numbers, links, first screen', async ({ page }, info) => {
  const errors = watchErrors(page);
  const phone = info.project.name.includes('iphone');
  if (!phone) await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?stats=mock&demo=dry');
  const strip = page.getByRole('region', { name: 'Behind the contract', exact: true });
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box?.y ?? Infinity).toBeLessThan(phone ? 2 * height : height);
  expect(await num(page, 'depth-features')).toBe(d.features);
  expect(await num(page, 'depth-tests')).toBe(d.tests);
  expect(await num(page, 'depth-findings')).toBe(d.findings);
  expect(await num(page, 'depth-scenarios')).toBe(d.scenarios);
  // SHOT_DIR (optional): a folder for evidence screenshots.
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/jamin-h1-${info.project.name}-home.png` });
  await expect(page.getByTestId('depth-findings-more')).toHaveText(new RegExp(`^→ ${d.upstreamPrs} pull requests`));
  await expect(page.getByTestId('depth-scenarios-more')).toHaveText(new RegExp(`^→ ${d.transactions} transactions$`));
  for (const id of ['depth-tests', 'depth-findings', 'depth-findings-more', 'depth-ported']) {
    expect(await page.getByTestId(id).getAttribute('href')).toMatch(new RegExp(`^${config.banner.repoUrl}/`));
  }
  await page.getByTestId('depth-features').click();
  await expect(page).toHaveURL(/#\/contract$/);
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(String(d.features)) })).toBeVisible();
  await page.goto('/?stats=mock&demo=dry');
  await page.getByTestId('depth-scenarios').click();
  await expect(page).toHaveURL(/#\/lifecycle$/);
  await page.goto('/?stats=mock&demo=dry');
  await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
  await expect(page.getByRole('region', { name: 'Di sebalik kontrak', exact: true })).toBeVisible();
  await expect(page.getByTestId('depth-ported')).toHaveText('Diport daripada OpenPeerEscrow (Solidity, EVM)');
  expect(errors).toEqual([]);
});

test('depth strip: no horizontal overflow at 320 px, both languages', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?stats=mock&demo=dry');
  for (const name of ['Behind the contract', 'Di sebalik kontrak']) {
    if (name !== 'Behind the contract') await page.getByRole('button', { name: 'Bahasa Melayu' }).click();
    const strip = page.getByRole('region', { name, exact: true });
    await strip.scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    const box = await strip.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  }
});
