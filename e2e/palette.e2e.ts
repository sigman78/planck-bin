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

  /** Press Escape in the open palette and sample the island width every frame until folded. */
  async function foldWidths(page: Page): Promise<number[]> {
    return page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const island = document.getElementById('island')!;
          const seen: number[] = [];
          const t0 = performance.now();
          const pinned = () => parseFloat(island.style.width);
          const tick = () => {
            seen.push(island.getBoundingClientRect().width);
            if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
            else resolve(seen);
          };
          island
            .querySelector<HTMLInputElement>('.island-input')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          // The width close() morphs to; the trace below must end there too.
          (window as unknown as { __foldTarget: number }).__foldTarget = pinned();
          requestAnimationFrame(tick);
        })
    );
  }

  /**
   * The fold ends at `target` without first collapsing to the bare mark and
   * growing back. The spring easing undershoots by up to about 6px; the bug
   * dipped 65px below the hover pill.
   */
  async function expectDirectFold(page: Page, widths: number[], target: number) {
    const trace = `widths: ${widths.map(Math.round).join(',')}`;
    // One morph, aimed at the final size (not a hover size that folds again later).
    const aimed = await page.evaluate(
      () => (window as unknown as { __foldTarget: number }).__foldTarget
    );
    expect(Math.abs(aimed - target), trace).toBeLessThan(1);
    expect(Math.abs(widths[widths.length - 1] - target), trace).toBeLessThan(1);
    expect(Math.min(...widths), trace).toBeGreaterThan(target - 10);
  }

  async function startCompact(page: Page) {
    await start(page);
    // The compact stage, where only hover or focus reveals the keycap.
    await page.evaluate(() => localStorage.setItem('haste-hint-stage', 'known'));
    await page.reload();
    await expect(page.locator(S.island)).toHaveAttribute('data-settled', '');
  }

  test('Escape under a hovering pointer folds straight into the hover pill', async ({ page }) => {
    await startCompact(page);
    const trigger = page.locator(S.paletteTrigger);
    await trigger.hover();
    await page.waitForTimeout(600); // hover expansion done
    const hoverWidth = await page.locator(S.island).evaluate((el) => el.offsetWidth);

    await trigger.click();
    await expect(page.locator(S.island)).toHaveClass(/open/);
    await page.waitForTimeout(600);

    await expectDirectFold(page, await foldWidths(page), hoverWidth);
    await expect(page.locator(S.island)).not.toHaveClass(/open/);
  });

  test('Escape after opening from the focused trigger folds into the focused pill', async ({
    page,
  }) => {
    await startCompact(page);
    await page.mouse.move(10, 300); // pointer well away from the island
    const trigger = page.locator(S.paletteTrigger);
    await trigger.focus();
    await page.waitForTimeout(600); // focus expansion done
    const focusWidth = await page.locator(S.island).evaluate((el) => el.offsetWidth);

    await page.keyboard.press('Enter');
    await expect(page.locator(S.island)).toHaveClass(/open/);
    await page.waitForTimeout(600);

    await expectDirectFold(page, await foldWidths(page), focusWidth);
    await expect(trigger).toBeFocused();
  });

  test('Escape with the pointer elsewhere folds to the compact pill as before', async ({
    page,
  }) => {
    await startCompact(page);
    await page.mouse.move(10, 300);
    const compactWidth = await page.locator(S.island).evaluate((el) => el.offsetWidth);

    await page.keyboard.press('Control+/');
    await expect(page.locator(S.island)).toHaveClass(/open/);
    await page.waitForTimeout(600);

    await expectDirectFold(page, await foldWidths(page), compactWidth);
  });

  test('Escape with the pointer over the open panel but not the pill folds to the compact pill', async ({
    page,
  }) => {
    await startCompact(page);
    await page.mouse.move(10, 300);
    const compactWidth = await page.locator(S.island).evaluate((el) => el.offsetWidth);

    await page.keyboard.press('Control+/');
    await expect(page.locator(S.island)).toHaveClass(/open/);
    await page.waitForTimeout(600);
    // Over the panel, left of where the folded pill will be.
    const box = (await page.locator(S.island).boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 60);
    await page.mouse.move(box.x + 41, box.y + 61);
    expect(await page.locator(S.island).evaluate((el) => el.matches(':hover'))).toBe(true);

    await expectDirectFold(page, await foldWidths(page), compactWidth);
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
    await closePalette(page);
  });

  test('Save is always listed: greyed out last when it cannot run, first when it can', async ({
    page,
  }) => {
    await start(page);
    await openPalette(page);
    const rows = page.locator(S.paletteRow);
    const saveRow = rows.filter({ has: page.locator('span', { hasText: /^Save$/ }) });
    await expect(saveRow).toHaveAttribute('aria-disabled', 'true');
    await expect(rows.last()).toHaveAttribute('aria-disabled', 'true');
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
    await expect(rows.first()).not.toHaveAttribute('aria-disabled', 'true');

    // Keyboard selection never lands on it.
    await page.keyboard.press('ArrowUp');
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
    await expect(saveRow).toHaveAttribute('aria-selected', 'false');
    await closePalette(page);

    await page.locator(S.editor).fill('content');
    await openPalette(page);
    await expect(rows.first()).toContainText('Save');
    await expect(rows.first()).not.toHaveAttribute('aria-disabled', 'true');
    await expect(rows.first().locator('kbd')).toHaveText('Ctrl+S');
  });

  test('a disabled Save matched by a filter does nothing on Enter', async ({ page }) => {
    await start(page);
    await openPalette(page);
    await page.locator(S.paletteInput).fill('save');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.island)).toHaveClass(/open/);
    await expect(page).toHaveURL('/');
  });

  test('command keys open the palette at find, go to line and a submenu', async ({ page }) => {
    await start(page);
    await savePaste(page, 'hello world');

    await page.keyboard.press('Alt+Shift+F');
    await expect(page.locator(S.island)).toHaveClass(/open/);
    await expect(page.locator(S.paletteInput)).toHaveValue('?');
    await closePalette(page);

    await page.keyboard.press('Alt+Shift+G');
    await expect(page.locator(S.paletteInput)).toHaveValue(':');
    await closePalette(page);

    await page.keyboard.press('Alt+Shift+L');
    await expect(page.locator('#island .island-crumb')).toHaveText('Language');
    await closePalette(page);

    await page.keyboard.press('Alt+Shift+=');
    await expect(page.locator(S.toast)).toHaveText('Font size 110%');
  });

  test('zoom commands flash a brief font-size toast', async ({ page }) => {
    await start(page);
    const toast = page.locator(S.toast);

    await runCommand(page, 'Zoom in');
    await expect(toast).toHaveText('Font size 110%');
    await expect(toast).toHaveClass(/visible/);
    await expect(toast).toHaveClass(/brief/);

    await runCommand(page, 'Reset zoom');
    await expect(toast).toHaveText('Font size 100%');
    await expect(toast).not.toHaveClass(/visible/, { timeout: 2500 });
  });

  test('Save in the pill stays put when hovered', async ({ page }) => {
    await start(page);
    await page.locator(S.editor).fill('content');
    const save = page.locator(S.saveBtn);
    await expect(save).toBeEnabled();
    await page.waitForTimeout(600);
    const before = await save.boundingBox();

    await save.hover();
    await expect(page.locator('#island .island-kc')).toBeVisible();
    await page.waitForTimeout(600);
    expect(await save.boundingBox()).toEqual(before);
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

  test('reopening starts at the first row with the list scrolled to the top', async ({ page }) => {
    await start(page);
    await savePaste(page, 'hello world');
    const selected = page.locator(S.paletteSelected);

    await openPalette(page);
    const first = await selected.textContent();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await expect(selected).not.toHaveText(first!);
    await page.keyboard.press('Escape');

    await openPalette(page);
    await expect(selected).toHaveText(first!);
    expect(await page.locator('#island-list').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('About opens the about document', async ({ page }) => {
    const store = await start(page);
    store.setFrozen('about', '# About this pastebin');

    await runCommand(page, 'About');
    await page.waitForURL(/\/about\.md$/);
    await expect(page.locator(S.viewer)).toContainText('About this pastebin');
  });
});
