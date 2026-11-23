import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { paletteLabel, runCommand } from './helpers/palette';

async function start(page: Page): Promise<void> {
  await setupMockApi(page);
  await page.goto('/');
  await expect(page.locator(S.editor)).toBeVisible();
}

const theme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));

/**
 * Background colors as sRGB bytes. Computed colors keep their oklch() form,
 * so each is painted to a canvas pixel and read back.
 */
const backgrounds = (page: Page, selectors: string[]) =>
  page.evaluate((sels) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    return sels.map((sel) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = getComputedStyle(document.querySelector(sel)!).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    });
  }, selectors);

const bodyBackground = async (page: Page) => (await backgrounds(page, ['body']))[0];

/** Resolved color of a syntax role, as the ::highlight() rules see it. */
const roleColor = (page: Page, role: string) =>
  page.evaluate((r) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--syntax-${r})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, role);

async function openThemeMenu(page: Page): Promise<void> {
  await runCommand(page, 'Theme');
  await expect(page.locator('#island .island-crumb')).toHaveText('Theme');
}

test.describe('Themes', () => {
  test('the menu opens on the current theme, which the Theme row names', async ({ page }) => {
    await start(page);
    await page.keyboard.press('Control+/');
    await page.locator(S.paletteInput).fill('Theme');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('Solarized Dark');
    await page.keyboard.press('Enter');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Solarized Dark');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('current');
  });

  test('picking a theme repaints the page and survives a reload', async ({ page }) => {
    await start(page);
    const keywordBefore = await roleColor(page, 'keyword');
    expect(await bodyBackground(page)).toBe('rgb(0, 43, 54)');

    await openThemeMenu(page);
    await page.locator(S.paletteInput).fill('GitHub');
    await page.keyboard.press('Enter');

    await expect.poll(() => theme(page)).toBe('github');
    expect(await bodyBackground(page)).toBe('rgb(255, 255, 255)');
    expect(await roleColor(page, 'keyword')).not.toBe(keywordBefore);
    expect(await page.evaluate(() => localStorage.getItem('haste-theme'))).toBe('github');

    await page.reload();
    await expect(page.locator(S.editor)).toBeVisible();
    expect(await theme(page)).toBe('github');
    // The inline frame background on <html> follows the theme too.
    expect(await backgrounds(page, ['html'])).toEqual(['rgb(255, 255, 255)']);

    // Back to the default: no attribute, no stored entry.
    await openThemeMenu(page);
    await page.locator(S.paletteInput).fill('Solarized Dark');
    await page.keyboard.press('Enter');
    await expect.poll(() => theme(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('haste-theme'))).toBeNull();
  });

  test('arrow keys preview a theme; Escape restores the current one', async ({ page }) => {
    await start(page);
    await openThemeMenu(page);

    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Solarized Light');
    expect(await theme(page)).toBe('solarized-light');
    await page.keyboard.press('ArrowDown');
    expect(await theme(page)).toBe('github');

    await page.keyboard.press('Escape');
    await expect(page.locator(S.island)).not.toHaveClass(/open/);
    expect(await theme(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('haste-theme'))).toBeNull();
  });

  test('a filter previews its top match; leaving the menu restores', async ({ page }) => {
    await start(page);
    await openThemeMenu(page);
    await page.locator(S.paletteInput).fill('mono');
    expect(await theme(page)).toBe('monokai');
    await page.locator(S.paletteInput).fill('zzz');
    expect(await theme(page)).toBeNull();
    await page.locator(S.paletteInput).fill('');
    await page.keyboard.press('Backspace');
    await expect(page.locator('#island .island-crumb')).toBeHidden();
    expect(await theme(page)).toBeNull();
  });

  test('hovering a theme does not preview it; clicking picks it', async ({ page }) => {
    await start(page);
    await openThemeMenu(page);
    const row = paletteLabel(page, 'Monokai');
    await row.hover();
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Monokai');
    expect(await theme(page)).toBeNull();
    await row.click();
    await expect.poll(() => theme(page)).toBe('monokai');
  });

  test('print stays on white paper under a dark non-default theme', async ({ page }) => {
    await start(page);
    await page.evaluate(() => localStorage.setItem('haste-theme', 'atom-one-dark'));
    await page.reload();
    await expect(page.locator(S.editor)).toBeVisible();
    expect(await theme(page)).toBe('atom-one-dark');

    await page.emulateMedia({ media: 'print' });
    expect(await backgrounds(page, ['html', 'body'])).toEqual([
      'rgb(255, 255, 255)',
      'rgb(255, 255, 255)',
    ]);
  });
});
