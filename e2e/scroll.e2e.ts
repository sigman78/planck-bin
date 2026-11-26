import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { openPalette } from './helpers/palette';

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

/** Horizontal layout facts: page overflow and whether an element scrolls itself. */
const metrics = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    return {
      pageWidth: document.documentElement.scrollWidth,
      windowWidth: document.documentElement.clientWidth,
      innerScroll: el.scrollWidth - el.clientWidth,
      right: el.getBoundingClientRect().right + window.scrollX,
    };
  }, selector);

test.describe('Long lines scroll the page', () => {
  test('the viewer widens the page instead of scrolling itself', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('wide', WIDE);
    await page.goto('/wide.txt');
    await expect(page.locator(S.viewer)).toContainText('line 1');
    const m = await metrics(page, S.viewer);
    expect(m.innerScroll).toBeLessThanOrEqual(1);
    expect(m.pageWidth).toBeGreaterThan(m.windowWidth);
    // The body's right padding stays after the widest line.
    expect(m.pageWidth - m.right).toBeGreaterThan(4);
  });

  test('short lines leave no horizontal page scroll', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', LONG);
    await page.goto('/abc.txt');
    await expect(page.locator(S.viewer)).toContainText('line 1');
    const m = await metrics(page, S.viewer);
    expect(m.pageWidth).toBe(m.windowWidth);
  });

  test('the editor widens the page too', async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/');
    await page.locator(S.editor).fill(WIDE);
    await expect
      .poll(async () => {
        const m = await metrics(page, S.editor);
        return m.pageWidth > m.windowWidth && m.innerScroll <= 1;
      })
      .toBe(true);
  });

  test('a rendered preview wraps and does not widen the page', async ({ page }) => {
    const store = await setupMockApi(page);
    const wideTable = `| a | b |\n|---|---|\n| ${'z'.repeat(2000)} | ${'q '.repeat(500)} |`;
    const fence = '```\n' + 'y'.repeat(3000) + '\n```';
    store.set('doc', ['# Title', 'word '.repeat(2000), fence, wideTable, ''].join('\n\n'));
    await page.goto('/doc.md#preview');
    await expect(page.locator('#preview')).toBeVisible();
    const m = await metrics(page, '#preview');
    expect(m.pageWidth).toBe(m.windowWidth);
  });

  test('find scrolls the page sideways to a match at the end of a long line', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set(
      'wide',
      WIDE.replace('line 3 ' + 'x'.repeat(400), 'line 3 ' + 'x'.repeat(400) + ' needle')
    );
    await page.goto('/wide.txt');
    await expect(page.locator(S.viewer)).toContainText('needle');
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await openPalette(page);
    await page.locator(S.paletteInput).fill('?needle');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('1/1');
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
  });
});
