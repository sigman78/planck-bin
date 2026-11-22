import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { openPalette, runCommand, expectCommand } from './helpers/palette';
import { S } from './helpers/selectors';

const CHIP = '#island .island-preview';
const PREVIEW = '#preview';
const DOC = [
  '# Notes',
  '',
  'Some *text* and a [link](https://example.com).',
  '',
  '- [x] done',
  '',
].join('\n');

/** Markdown chunks requested so far (the renderer must load only on demand). */
function trackMarkdownLoads(page: Page): string[] {
  const loads: string[] = [];
  page.on('request', (req) => {
    if (/markdown-it|preview[/\\]markdown|dompurify/i.test(req.url())) loads.push(req.url());
  });
  return loads;
}

test.describe('Markdown preview', () => {
  test('the chip toggles the rendered document and the #preview hash', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    const loads = trackMarkdownLoads(page);
    await page.goto('/abc.md');
    await expect(page.locator(S.viewer)).toContainText('# Notes');

    const chip = page.locator(CHIP);
    await expect(chip).toBeEnabled();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(PREVIEW)).toBeHidden();
    expect(loads).toEqual([]);

    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Notes');
    await expect(page.locator(`${PREVIEW} em`)).toHaveText('text');
    await expect(page.locator(`${PREVIEW} a`)).toHaveAttribute('target', '_blank');
    await expect(page.locator(`${PREVIEW} input[type=checkbox]`)).toBeChecked();
    await expect(page.locator(S.viewer)).toBeHidden();
    await expect(page).toHaveURL(/\/abc\.md#preview$/);
    expect(loads.length).toBeGreaterThan(0);

    // A shared link opens in preview.
    await page.reload();
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Notes');
    await expect(page.locator(CHIP)).toHaveAttribute('aria-pressed', 'true');

    await page.locator(CHIP).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page.locator(PREVIEW)).toBeHidden();
    await expect(page).toHaveURL(/\/abc\.md$/);
  });

  test('Alt+Shift+V and the palette command toggle it too', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    await page.goto('/abc.md');
    await expect(page.locator(S.viewer)).toContainText('# Notes');

    await page.keyboard.press('Alt+Shift+KeyV');
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();
    await runCommand(page, 'Exit preview');
    await expect(page.locator(S.viewer)).toBeVisible();
    await runCommand(page, 'Preview markdown');
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();
  });

  test('is not offered for code or while editing', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', 'const a = 1;');
    await page.goto('/abc.js');
    await expect(page.locator(S.viewer)).toContainText('const a');
    await expect(page.locator(CHIP)).toBeDisabled();
    await expectCommand(page, 'Preview markdown', false);

    await page.goto('/');
    await expect(page.locator(S.editor)).toBeVisible();
    await expect(page.locator(CHIP)).toBeDisabled();
  });

  test('switching the language away from markdown leaves the preview', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    await page.goto('/abc.md#preview');
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();

    await runCommand(page, 'Switch language');
    await page.locator(S.paletteInput).fill('Plain text');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/abc\.txt$/);
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page.locator(PREVIEW)).toBeHidden();
    await expect(page.locator(CHIP)).toBeDisabled();
  });

  test('go to line and find return to the source', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    await page.goto('/abc.md#preview');
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();

    await openPalette(page);
    await page.locator(S.paletteInput).fill(':3');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/abc\.md#L3$/);
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page.locator('#line-highlight')).toHaveClass(/visible/);

    await page.locator(CHIP).click();
    await expect(page.locator(PREVIEW)).toBeVisible();
    await openPalette(page);
    await page.locator(S.paletteInput).fill('?text');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Find "text"');
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page.locator(PREVIEW)).toBeHidden();
  });

  test('the about page opens in preview, #source shows its text', async ({ page }) => {
    const store = await setupMockApi(page);
    store.setFrozen('about', '# About this pastebin');
    await page.goto('/about.md');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('About this pastebin');
    await expect(page).toHaveURL(/\/about\.md$/);
    // While on, the command is named for what it does, and "preview" finds it.
    await openPalette(page);
    await page.locator(S.paletteInput).fill('preview');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Exit preview');
    await page.keyboard.press('Escape');

    await page.locator(CHIP).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page).toHaveURL(/\/about\.md#source$/);
    await page.reload();
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page.locator(PREVIEW)).toBeHidden();
  });

  test('a #preview link never shows the source first', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    // Hold the renderer back: the source must stay hidden while it loads.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/preview\/markdown/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/abc.md#preview');
    await expect(page.locator(S.viewer)).toContainText('# Notes');
    await expect(page.locator(S.viewer)).toBeHidden();
    await expect(page.locator(PREVIEW)).toBeHidden();
    release();
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Notes');
    await expect(page.locator(S.viewer)).toBeHidden();
  });

  test('clearing the hash returns to the default view', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    store.setFrozen('about', '# About this pastebin');

    await page.goto('/abc.md#preview');
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();
    await page.evaluate(() => (window.location.hash = ''));
    await expect(page.locator(S.viewer)).toBeVisible();
    await expect(page.locator(PREVIEW)).toBeHidden();

    await page.goto('/about.md#source');
    await expect(page.locator(S.viewer)).toBeVisible();
    await page.evaluate(() => (window.location.hash = ''));
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();
  });

  test('Back returns to the preview', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    await page.goto('/abc.md');
    await page.locator(CHIP).click();
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();

    await runCommand(page, 'New paste');
    await expect(page.locator(S.editor)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/abc\.md#preview$/);
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('Notes');
    await expect(page.locator(S.viewer)).toBeHidden();
  });

  test('raw HTML in the paste stays text', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', '<img src=x onerror="window.pwned=1"> <script>window.pwned=1</script>');
    await page.goto('/abc.md#preview');
    await expect(page.locator(PREVIEW)).toContainText('<script>');
    await expect(page.locator(`${PREVIEW} img, ${PREVIEW} script`)).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)
    ).toBeUndefined();
  });

  test('prints the rendered document while previewing', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', DOC);
    await page.goto('/abc.md#preview');
    await expect(page.locator(`${PREVIEW} h1`)).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.locator('#print-listing h1')).toHaveText('Notes');
    await expect(page.locator('#print-listing .pl-row')).toHaveCount(0);
    await expect(page.locator('#print-listing')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#print-listing')).toHaveCount(0);
  });
});
