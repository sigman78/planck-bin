import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { expectCommand, openPalette, paletteLabel, runCommand } from './helpers/palette';
import { renderBurnPage } from '../src/worker/render';

const GATE = '#island.prompting .island-prompt';
const REVEAL = '#island .island-prompt-confirm';
const CANCEL = '#island .island-prompt-cancel';

/** Record every GET of /documents/:key. */
function watchLoads(page: Page): string[] {
  const loads: string[] = [];
  page.on('request', (req) => {
    if (/\/documents\//.test(req.url()) && req.method() === 'GET') loads.push(req.url());
  });
  return loads;
}

async function typeAndSave(page: Page, text: string) {
  await expect(page.locator(S.editor)).toBeVisible();
  await page.locator(S.editor).fill(text);
  await page.locator(S.saveBtn).click();
  await expect(page.locator(S.viewer)).toBeVisible();
}

async function pickLifetime(page: Page, label: string) {
  await runCommand(page, 'Expires');
  await page.locator(S.paletteInput).fill(label);
  await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText(label);
  await page.keyboard.press('Enter');
}

test.describe('Paste lifetime', () => {
  test('the chosen lifetime is sent with the save and remembered', async ({ page }) => {
    const store = await setupMockApi(page);
    await page.goto('/');
    await expect(page.locator(S.editor)).toBeVisible();

    await pickLifetime(page, '1 week');
    await page.locator(S.editor).fill('hello');
    await expect(page.locator(S.saveBtn)).toHaveText('Save (1w)');
    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    expect(store.lastSaveParams()?.get('expires')).toBe('1w');

    await page.goto('/');
    await page.locator(S.editor).fill('again');
    await expect(page.locator(S.saveBtn)).toHaveText('Save (1w)');

    await pickLifetime(page, 'Server default');
    await expect(page.locator(S.saveBtn)).toHaveText('Save');
    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    expect(store.lastSaveParams()?.has('expires')).toBe(false);
  });

  test('lifetime and burn are not offered while viewing', async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/');
    await typeAndSave(page, 'x');
    await expectCommand(page, 'Expires', false);
    await expectCommand(page, 'Burn after reading', false);
  });
});

test.describe('Burn after reading', () => {
  test('the creator sees it without reading it; the toggle is one-shot', async ({ page }) => {
    const store = await setupMockApi(page);
    const loads = watchLoads(page);
    await page.goto('/');
    await expect(page.locator(S.editor)).toBeVisible();
    await page.locator(S.editor).fill('top secret');

    await openPalette(page);
    await page.locator(S.paletteInput).fill('Burn after reading');
    await page.keyboard.press('Enter');
    // Stays open with the new state in the hint.
    await expect(page.locator(S.paletteSelected)).toContainText('on');
    await page.keyboard.press('Escape');
    await expect(page.locator(S.saveBtn)).toHaveText('Save (burn)');

    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toContainText('top secret');
    expect(store.lastSaveParams()?.get('burn')).toBe('1');
    expect(loads).toEqual([]);
    expect(store.get('testkey0')).toBe('top secret');

    await expectCommand(page, 'View raw', false);
    await openPalette(page);
    await page.locator(S.paletteInput).fill('Recent pastes');
    await page.keyboard.press('Enter');
    await expect(paletteLabel(page, 'top secret')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Alt+Shift+P');
    await expect(page.locator(S.editor)).toBeVisible();
    await page.locator(S.editor).fill('next');
    await expect(page.locator(S.saveBtn)).toHaveText('Save');
  });

  test('a reader gets the prompt, and Open reads it exactly once', async ({ page }) => {
    const store = await setupMockApi(page);
    store.setBurn('secret', 'the launch code');
    const loads = watchLoads(page);

    await page.goto('/secret');
    await expect(page.locator(GATE)).toBeVisible();
    await expect(page.locator(REVEAL)).toBeFocused();
    await expect(page.locator(S.viewer)).toBeHidden();
    await expect(page.locator(S.editor)).toBeHidden();
    expect(loads.every((url) => url.includes('peek=1'))).toBe(true);
    expect(store.get('secret')).toBe('the launch code');

    // It has to be answered: Escape, the palette shortcut and outside clicks do nothing.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+/');
    await page.mouse.click(20, 300);
    await expect(page.locator(GATE)).toBeVisible();
    await expect(page.locator(S.island)).not.toHaveClass(/open/);

    await page.locator(REVEAL).click();
    await expect(page.locator(S.viewer)).toContainText('the launch code');
    await expect(page.locator(S.island)).not.toHaveClass(/prompting/);
    expect(store.get('secret')).toBeUndefined();
    expect(loads.filter((url) => !url.includes('peek=1'))).toHaveLength(1);
    await expectCommand(page, 'Copy link', false);

    // Gone for everyone else: the next visit is the not-found flow.
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/secret');
    await expect(page.locator(S.editor)).toBeVisible();
    await expect(page.locator(S.toast)).toContainText('not found');
  });

  test('offline at Open: nothing is lost and the prompt stays', async ({ page }) => {
    const store = await setupMockApi(page);
    store.setBurn('secret', 'the launch code');
    await page.goto('/secret');
    await expect(page.locator(GATE)).toBeVisible();

    await page.route('**/documents/secret', (route) => route.abort('internetdisconnected'));
    await page.locator(REVEAL).click();
    await expect(page.locator(S.toast)).toContainText('Could not reach the server');
    await expect(page.locator(GATE)).toBeVisible();
    await expect(page.locator(REVEAL)).toBeEnabled();
    await expect(page.locator(S.viewer)).toBeHidden();
    expect(store.get('secret')).toBe('the launch code');

    await page.unroute('**/documents/secret');
    await page.locator(REVEAL).click();
    await expect(page.locator(S.viewer)).toContainText('the launch code');
    expect(store.get('secret')).toBeUndefined();
  });

  test('New paste leaves it unread', async ({ page }) => {
    const store = await setupMockApi(page);
    store.setBurn('secret', 'the launch code');
    await page.goto('/secret');
    await page.locator(CANCEL).click();
    await expect(page.locator(S.editor)).toBeVisible();
    await expect(page.locator(S.island)).not.toHaveClass(/prompting/);
    expect(page.url()).toMatch(/\/$/);
    expect(store.get('secret')).toBe('the launch code');
  });

  test('server-rendered burn page shows the prompt without any read', async ({ page }) => {
    const store = await setupMockApi(page);
    store.setBurn('secret', 'the launch code');
    const loads = watchLoads(page);
    await page.route('**/secret', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const shell = await (
        await route.fetch({ url: new URL('/', route.request().url()).href })
      ).text();
      const html = renderBurnPage(shell, 'secret');
      expect(html, 'dev shell lost a render anchor').not.toBeNull();
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html! });
    });

    await page.goto('/secret');
    await expect(page.locator(GATE)).toBeVisible();
    expect(loads).toEqual([]);

    await page.locator(REVEAL).click();
    await expect(page.locator(S.viewer)).toContainText('the launch code');
    expect(loads).toHaveLength(1);
    expect(loads[0]).not.toContain('peek');
  });
});
