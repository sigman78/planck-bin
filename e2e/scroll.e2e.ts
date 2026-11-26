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

  test('saving returns to the line starts, not the sideways position', async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/');
    await page.locator(S.editor).fill(WIDE);
    await page.evaluate(() => window.scrollTo({ top: 300, left: 2000, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
  });

  test('go to line shows the line start', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('wide', WIDE);
    await page.goto('/wide.txt');
    await expect(page.locator(S.viewer)).toContainText('line 1');
    await page.evaluate(() => window.scrollTo({ left: 2000, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
    await openPalette(page);
    await page.locator(S.paletteInput).fill(':50');
    await page.keyboard.press('Enter');
    await expect(page.locator('#line-highlight')).toHaveClass(/visible/);
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0);
  });

  test('line numbers stay pinned at the left edge when scrolled sideways', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('wide', WIDE);
    await page.goto('/wide.txt#L5');
    await expect(page.locator('#line-highlight')).toHaveClass(/visible/);
    await page.evaluate(() => window.scrollTo({ left: 2000, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
    const gutter = (await page.locator('#gutter').boundingBox())!;
    expect(gutter.x).toBe(0);
    await expect(page.locator('#L5')).toBeInViewport();
    // The current-line highlight shows across the numbers too.
    const hit = await page.evaluate(() => {
      const box = document.querySelector('#L5')!.getBoundingClientRect();
      return document
        .elementsFromPoint(box.left + 2, box.top + box.height / 2)
        .map((el) => el.id)
        .filter(Boolean);
    });
    expect(hit.indexOf('line-highlight')).toBeLessThan(hit.indexOf('gutter'));
  });

  test('find keeps a match clear of the pinned line numbers', async ({ page }) => {
    const store = await setupMockApi(page);
    // The match is early in a line, after a far-right match moved the page sideways.
    const text = WIDE.replace('line 3 ', 'line 3 needle ').replace(
      'line 2 ' + 'x'.repeat(400),
      'line 2 ' + 'x'.repeat(400) + ' needle'
    );
    store.set('wide', text);
    await page.goto('/wide.txt');
    await expect(page.locator(S.viewer)).toContainText('needle');
    await openPalette(page);
    await page.locator(S.paletteInput).fill('?needle');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('1/2');
    // Put the line 3 match under the pinned numbers, then step to it.
    const needleRect = () =>
      page.evaluate(() => {
        const code = document.querySelector('#viewer code')!.firstChild as Text;
        const at = code.data.indexOf('needle', code.data.indexOf('line 3 '));
        const range = new Range();
        range.setStart(code, at);
        range.setEnd(code, at + 6);
        const r = range.getBoundingClientRect();
        return {
          left: r.left,
          gutterRight: document.querySelector('#gutter')!.getBoundingClientRect().right,
        };
      });
    const before = await needleRect();
    await page.evaluate(
      (x) => window.scrollTo({ left: window.scrollX + x, behavior: 'instant' }),
      before.left - 5
    );
    expect((await needleRect()).left).toBeLessThan(before.gutterRight);
    await page.keyboard.press('Enter');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('2/2');
    const after = await needleRect();
    const clear = after.left - after.gutterRight;
    expect(clear).toBeGreaterThanOrEqual(0);
  });
});
