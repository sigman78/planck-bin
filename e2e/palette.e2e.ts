import { test, expect, type Page } from '@playwright/test';
import { setupMockApi, type MockStore } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { openPalette, closePalette, paletteLabel, runCommand } from './helpers/palette';

async function savePaste(page: Page, content: string): Promise<void> {
  await page.locator(S.editor).fill(content);
  await page.locator(S.saveBtn).click();
  await expect(page.locator(S.viewer)).toBeVisible();
}

async function start(page: Page): Promise<MockStore> {
  const store = await setupMockApi(page);
  await page.goto('/');
  await expect(page.locator(S.editor)).toBeVisible();
  return store;
}

test.describe('Command palette', () => {
  test('opens with Ctrl+/ and closes with Escape, restoring editor focus', async ({ page }) => {
    await start(page);
    await page.locator(S.editor).focus();

    await openPalette(page);
    await expect(page.locator(S.paletteTrigger)).toHaveAttribute('aria-expanded', 'true');

    await closePalette(page);
    await expect(page.locator(S.editor)).toBeFocused();
    await expect(page.locator(S.paletteTrigger)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Ctrl+/ toggles the palette closed again', async ({ page }) => {
    await start(page);
    await openPalette(page);
    await page.keyboard.press('Control+/');
    await expect(page.locator(S.island)).not.toHaveClass(/open/);
  });

  test('opens on trigger click and closes on outside click', async ({ page }) => {
    await start(page);
    await page.locator(S.paletteTrigger).click();
    await expect(page.locator(S.island)).toHaveClass(/open/);

    await page.mouse.click(200, 300);
    await expect(page.locator(S.island)).not.toHaveClass(/open/);
  });

  test('clicking the pill while editing returns focus to the editor on Escape', async ({
    page,
  }) => {
    await start(page);
    await page.locator(S.editor).fill('keep my caret');
    await page.locator(S.paletteTrigger).click();
    await expect(page.locator(S.paletteInput)).toBeFocused();
    await closePalette(page);
    await expect(page.locator(S.editor)).toBeFocused();
  });

  test('folded pill collapses back to its folded width', async ({ page }) => {
    await start(page);
    const island = page.locator(S.island);
    const folded = (await island.boundingBox())!.width;

    await openPalette(page);
    await expect.poll(async () => (await island.boundingBox())!.width).toBeGreaterThan(folded + 50);

    await closePalette(page);
    await expect
      .poll(async () => Math.round((await island.boundingBox())!.width))
      .toBeLessThanOrEqual(Math.round(folded) + 1);
  });

  test('typing filters commands and Enter runs the selected one', async ({ page }) => {
    await start(page);
    await savePaste(page, 'hello palette');

    await openPalette(page);
    await page.locator(S.paletteInput).fill('new');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('New paste');
    await page.keyboard.press('Enter');

    await page.waitForURL('/');
    await expect(page.locator(S.editor)).toHaveValue('');
  });

  test('clicking a row runs it and leaves the palette closed', async ({ page }) => {
    await start(page);
    await savePaste(page, 'click me');
    await openPalette(page);
    await paletteLabel(page, 'Zoom in').click();

    await expect(page.locator(S.island)).not.toHaveClass(/open/);
    await page.waitForTimeout(300);
    await expect(page.locator(S.island)).not.toHaveClass(/open/);
    await expect(page.locator('#editor-container')).toHaveCSS('--editor-zoom', '1.1');
  });

  test('arrow keys move the selection', async ({ page }) => {
    await start(page);
    await openPalette(page);
    const rows = page.locator(S.paletteRow);
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.first()).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('ArrowUp');
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('shows only commands available in the current mode', async ({ page }) => {
    await start(page);
    await openPalette(page);
    await expect(paletteLabel(page, 'Copy link')).toHaveCount(0);
    await expect(paletteLabel(page, 'Save')).toHaveCount(0);
    await closePalette(page);

    await page.locator(S.editor).fill('content');
    await openPalette(page);
    await expect(paletteLabel(page, 'Save')).toHaveCount(1);
  });

  test('save chip is disabled when empty and enabled with content', async ({ page }) => {
    await start(page);
    await expect(page.locator(S.saveBtn)).toBeDisabled();

    await page.locator(S.editor).fill('x');
    await expect(page.locator(S.saveBtn)).toBeEnabled();

    await page.locator(S.saveBtn).click();
    await page.waitForURL(/\/testkey0/);
    await expect(page.locator(S.saveBtn)).toBeDisabled();
  });

  test('go to line while presenting sets the anchor and highlights it', async ({ page }) => {
    await start(page);
    await savePaste(page, 'one\ntwo\nthree\nfour\nfive');

    await openPalette(page);
    await page.locator(S.paletteInput).fill(':3');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Go to line 3');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/testkey0[^#]*#L3$/);
    await expect(page.locator('#line-highlight')).toHaveClass(/visible/);
    await expect(page.locator('#line-highlight')).toHaveCSS('--line-index', '2');
    await expect(page.locator(S.island)).not.toHaveClass(/open/);
  });

  test('go to line while editing moves the caret and clamps', async ({ page }) => {
    await start(page);
    await page.locator(S.editor).fill('one\ntwo\nthree');

    await openPalette(page);
    await page.locator(S.paletteInput).fill(':2');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.editor)).toBeFocused();
    expect(
      await page.locator(S.editor).evaluate((el: HTMLTextAreaElement) => el.selectionStart)
    ).toBe(4);

    await openPalette(page);
    await page.locator(S.paletteInput).fill(':99');
    await page.keyboard.press('Enter');
    expect(
      await page.locator(S.editor).evaluate((el: HTMLTextAreaElement) => el.selectionStart)
    ).toBe(8);
  });

  test('an incomplete line query offers no action', async ({ page }) => {
    await start(page);
    await openPalette(page);
    await page.locator(S.paletteInput).fill(':');
    await expect(page.locator(S.paletteRow)).toHaveText(['Type a line number']);
    await expect(page.locator(S.paletteRow).first()).toHaveAttribute('aria-disabled', 'true');
  });

  test('find in paste counts matches and steps through them', async ({ page }) => {
    await start(page);
    await savePaste(page, 'foo one\nbar foo\nFOO end');
    const findRow = page.locator(`${S.paletteSelected} kbd`);
    const highlights = () =>
      page.evaluate(() => (CSS.highlights as unknown as Map<string, Highlight>).size);

    await openPalette(page);
    await page.locator(S.paletteInput).fill('?foo');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Find "foo"');
    await expect(findRow).toHaveText('1/3');
    expect(await highlights()).toBe(2);

    await page.keyboard.press('Enter');
    await expect(findRow).toHaveText('2/3');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(findRow).toHaveText('1/3');
    await page.keyboard.press('Shift+Enter');
    await expect(findRow).toHaveText('3/3');

    await closePalette(page);
    expect(await highlights()).toBe(0);
  });

  test('find reports no matches and a filter offers a find row', async ({ page }) => {
    await start(page);
    await savePaste(page, 'alpha beta');

    await openPalette(page);
    await page.locator(S.paletteInput).fill('?zzz');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('No matches');

    await page.locator(S.paletteInput).fill('beta');
    await expect(paletteLabel(page, 'Find "beta"')).toHaveCount(1);
  });

  test('find is not offered while editing', async ({ page }) => {
    await start(page);
    await page.locator(S.editor).fill('text');
    await openPalette(page);
    await page.locator(S.paletteInput).fill('?text');
    await expect(page.locator(S.paletteRow)).toHaveText(['Find works while viewing a paste']);
  });

  test('switch language re-highlights and updates the URL extension', async ({ page }) => {
    await start(page);
    await savePaste(page, 'def greet(name):\n    return "hi " + name\n');

    await runCommand(page, 'Switch language');
    await expect(page.locator('#island .island-crumb')).toHaveText('Language');
    await page.locator(S.paletteInput).fill('Python');
    await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText('Python');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/testkey0\.py$/);
    await expect(page.locator('#viewer .hljs-keyword').first()).toBeVisible();

    await runCommand(page, 'Switch language');
    await page.locator(S.paletteInput).fill('Plain text');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/testkey0\.txt$/);
    await expect(page.locator('#viewer [class^="hljs-"]')).toHaveCount(0);
    await expect(page.locator(S.viewer)).toContainText('def greet(name):');

    // The chosen language must survive a reload / shared link.
    await page.reload();
    await expect(page.locator(S.viewer)).toContainText('def greet(name):');
    await expect(page).toHaveURL(/\/testkey0\.txt$/);
    await expect(page.locator('#viewer [class^="hljs-"]')).toHaveCount(0);

    // ...and stay plain text as far as the palette and recents are concerned.
    await runCommand(page, 'Switch language');
    await expect(
      page
        .locator(S.paletteRow)
        .filter({ has: page.locator('span', { hasText: /^Plain text$/ }) })
        .locator('kbd')
    ).toHaveText('current');
    const paths = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('haste-recent') ?? '[]').map((e: { path: string }) => e.path)
    );
    expect(paths[0]).toBe('/testkey0.txt');
  });

  test('Backspace on an empty submenu filter returns to commands', async ({ page }) => {
    await start(page);
    await savePaste(page, 'x = 1');

    await runCommand(page, 'Switch language');
    await expect(page.locator('#island .island-crumb')).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(page.locator('#island .island-crumb')).toBeHidden();
    await expect(paletteLabel(page, 'Copy link')).toHaveCount(1);
  });

  test('recent pastes lists saved pastes newest first and opens one', async ({ page }) => {
    await start(page);
    await savePaste(page, 'first paste');
    await runCommand(page, 'New paste');
    await page.waitForURL('/');
    await savePaste(page, 'second paste');
    await page.waitForURL(/\/testkey1/);

    await runCommand(page, 'Recent pastes');
    await expect(page.locator(`${S.paletteRow} > span`)).toHaveText([
      'second paste',
      'first paste',
      'Clear recent pastes',
    ]);
    await page.locator(S.paletteInput).fill('first');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/testkey0/);
    await expect(page.locator(S.viewer)).toContainText('first paste');
  });

  test('recent entries follow a language switch', async ({ page }) => {
    await start(page);
    await savePaste(page, 'print("hello")');
    await runCommand(page, 'Switch language');
    await page.locator(S.paletteInput).fill('Plain text');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\.txt$/);

    const paths = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('haste-recent') ?? '[]').map((e: { path: string }) => e.path)
    );
    expect(paths).toEqual(['/testkey0.txt']);
  });

  test('clearing recent pastes empties the list', async ({ page }) => {
    await start(page);
    await savePaste(page, 'only paste');

    await runCommand(page, 'Recent pastes');
    await page.locator(S.paletteInput).fill('Clear recent');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.toast)).toContainText('Recent pastes cleared');

    await runCommand(page, 'Recent pastes');
    await expect(page.locator('#island .island-empty')).toHaveText('No recent pastes');
  });

  test('first visit shows the hint text, typing demotes it to the keycap', async ({ page }) => {
    await start(page);
    const island = page.locator(S.island);
    await expect(island).toHaveAttribute('data-stage', 'first');
    await expect(page.locator('#island .island-text')).toBeVisible();
    await expect(page.locator('#island .island-kc')).toBeVisible();

    await page.locator(S.editor).fill('typing');
    await expect(island).toHaveAttribute('data-stage', 'learn');
    await expect(page.locator('#island .island-text')).toBeHidden();
    await expect(page.locator('#island .island-kc')).toBeVisible();
  });

  test('first-visit hint folds by itself after a few seconds', async ({ page }) => {
    await page.clock.install();
    await start(page);
    await expect(page.locator(S.island)).toHaveAttribute('data-stage', 'first');
    await page.clock.runFor(8500);
    await expect(page.locator(S.island)).toHaveAttribute('data-stage', 'learn');
  });

  test('opening the palette once retires the hint across reloads', async ({ page }) => {
    await start(page);
    await openPalette(page);
    await closePalette(page);
    await expect(page.locator(S.island)).toHaveAttribute('data-stage', 'known');

    await page.reload();
    await expect(page.locator(S.editor)).toBeVisible();
    await expect(page.locator(S.island)).toHaveAttribute('data-stage', 'known');
    await page.mouse.move(10, 400);
    await expect(page.locator('#island .island-kc')).toBeHidden();
  });

  test('About opens the about document', async ({ page }) => {
    const store = await start(page);
    store.setFrozen('about', '# About this pastebin');

    await runCommand(page, 'About');
    await page.waitForURL(/\/about\.md$/);
    await expect(page.locator(S.viewer)).toContainText('About this pastebin');
  });
});
