import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { paintedTexts } from './helpers/syntax';

const LISTING = '#print-listing';

/** Run the beforeprint step under print media, as the browser does. */
async function beforePrint(page: Page) {
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
}

async function afterPrint(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
}

const SRC = ['/* one', '   two */', 'const a = "x";', '', 'f(a);'].join('\n');

test.describe('Print listing', () => {
  test('prints one numbered row per line, without syntax colors', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', SRC);
    await page.goto('/abc.js');
    await expect(page.locator(S.viewer)).toContainText('const a');
    const before = (await paintedTexts(page)).length;

    await beforePrint(page);
    const rows = page.locator(`${LISTING} .pl-row`);
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(3).locator('.pl-num')).toHaveText('4');
    await expect(rows.nth(1).locator('.pl-code')).toHaveText('   two */');
    // Only the listing prints.
    await expect(page.locator(LISTING)).toBeVisible();
    await expect(page.locator(S.viewer)).toBeHidden();
    await expect(page.locator(S.island)).toBeHidden();
    // Plain text on paper: the listing adds no syntax ranges.
    expect((await paintedTexts(page)).length).toBe(before);

    await afterPrint(page);
    await expect(page.locator(LISTING)).toHaveCount(0);
    expect((await paintedTexts(page)).length).toBe(before);
    await expect(page.locator(S.viewer)).toBeVisible();
  });

  test('prints the editor text while editing, and nothing for an empty editor', async ({
    page,
  }) => {
    await setupMockApi(page);
    await page.goto('/');
    await expect(page.locator(S.editor)).toBeVisible();

    await beforePrint(page);
    await expect(page.locator(LISTING)).toHaveCount(0);
    await afterPrint(page);

    await page.locator(S.editor).fill('first\r\nsecond');
    await beforePrint(page);
    await expect(page.locator(`${LISTING} .pl-code`)).toHaveText(['first', 'second']);
    await afterPrint(page);
  });

  test('puts the address, line count and page numbers in the page margins', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', SRC);
    await page.goto('/abc.js');
    await expect(page.locator(S.viewer)).toContainText('const a');

    await beforePrint(page);
    const pageCss = await page.locator('#print-page').textContent();
    expect(pageCss).toContain('/abc.js');
    expect(pageCss).toContain('"5 lines"');
    await afterPrint(page);
    await expect(page.locator('#print-page')).toHaveCount(0);
  });
});
