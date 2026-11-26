import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';

const LONG = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');

test.describe('Scroll on load', () => {
  test('a #L link scrolls its line into view', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', LONG);
    await page.goto('/abc.txt#L150');
    await expect(page.locator(S.viewer)).toContainText('line 150');
    await expect(page.locator('#line-highlight')).toHaveClass(/visible/);
    await expect(page.locator('#L150')).toBeInViewport();
  });

  test('reload keeps the current position, not an older remembered one', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', LONG);
    await page.goto('/abc.txt');
    await expect(page.locator(S.viewer)).toContainText('line 1');
    // A position remembered earlier (as a navigation away would leave it).
    await page.evaluate(() => history.replaceState({ scrollY: 25 }, ''));
    // ...then the reader scrolls down and back to the top.
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.waitForTimeout(300); // the position is recorded once scrolling settles
    await page.reload();
    await expect(page.locator(S.viewer)).toContainText('line 1');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator(S.viewer)).toContainText('line 1');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  });
});

const WIDE = Array.from({ length: 200 }, (_, i) => `line ${i + 1} ` + 'x'.repeat(400)).join('\n');

test.describe('Sticky horizontal scrollbar', () => {
  const bar = '.sticky-scrollbar';

  test('pins to the window bottom for long lines and drives the viewer', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('wide', WIDE);
    await page.goto('/wide.txt');
    await expect(page.locator(S.viewer)).toContainText('line 1');
    const sticky = page.locator(bar).first();
    await expect(page.locator(`${bar}:not([hidden])`)).toHaveCount(1);
    const box = await sticky.boundingBox();
    const height = page.viewportSize()!.height;
    expect(Math.round(box!.y + box!.height)).toBe(height);

    await page.locator(`${bar}:not([hidden])`).evaluate((el) => (el.scrollLeft = 300));
    await expect.poll(() => page.locator(S.viewer).evaluate((el) => el.scrollLeft)).toBe(300);
    await page.locator(S.viewer).evaluate((el) => (el.scrollLeft = 120));
    await expect
      .poll(() => page.locator(`${bar}:not([hidden])`).evaluate((el) => el.scrollLeft))
      .toBe(120);

    // At the end of the paste the viewer's own scrollbar is in view: the stand-in goes.
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
    );
    await expect(page.locator(`${bar}:not([hidden])`)).toHaveCount(0);
  });

  test('stays hidden when no line is wider than the viewer', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', LONG);
    await page.goto('/abc.txt');
    await expect(page.locator(S.viewer)).toContainText('line 1');
    await page.waitForTimeout(100);
    await expect(page.locator(`${bar}:not([hidden])`)).toHaveCount(0);
  });

  test('works for the editor too', async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/');
    await page.locator(S.editor).fill(WIDE);
    await expect(page.locator(`${bar}:not([hidden])`)).toHaveCount(1);
  });
});
