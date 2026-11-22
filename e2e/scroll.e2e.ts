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
