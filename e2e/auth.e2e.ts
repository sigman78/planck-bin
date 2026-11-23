import { test, expect, type Page } from '@playwright/test';
import { setupMockApi, type MockStore } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { openPalette, closePalette, paletteLabel, runCommand } from './helpers/palette';

async function start(page: Page, options: { auth?: boolean } = { auth: true }) {
  const store = await setupMockApi(page, options);
  await page.goto('/');
  await expect(page.locator(S.editor)).toBeVisible();
  return store;
}

async function signIn(page: Page): Promise<void> {
  await runCommand(page, 'Sign in');
  // The mock provider comes straight back to where we were.
  await expect(page.locator(S.editor)).toBeVisible();
  await expect.poll(async () => (await openAndList(page)).includes('Sign out')).toBe(true);
  await closePalette(page);
}

async function openAndList(page: Page): Promise<string[]> {
  await openPalette(page);
  return page.locator(`${S.paletteRow} > span`).allTextContents();
}

async function savePaste(page: Page, content: string): Promise<void> {
  await page.locator(S.editor).fill(content);
  await page.locator(S.saveBtn).click();
  await expect(page.locator(S.viewer)).toBeVisible();
}

const recent = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('haste-recent') ?? '[]'));

test.describe('Sign-in', () => {
  test('is offered once the palette learns sign-in is on', async ({ page }) => {
    await start(page);
    const rows = await openAndList(page);
    await expect(paletteLabel(page, 'Sign in')).toHaveCount(1);
    expect(rows).not.toContain('My pastes');
    expect(rows).not.toContain('Make private');
  });

  test('is not offered when the server has no sign-in', async ({ page }) => {
    await start(page, {});
    await page.route('**/auth/me', (route) =>
      route.fulfill({ json: { enabled: false, user: null } })
    );
    await openPalette(page);
    await page.locator(S.paletteInput).fill('sign');
    await expect(paletteLabel(page, 'Sign in')).toHaveCount(0);
  });

  test('signs in and out; the name shows on the Sign out row', async ({ page }) => {
    await start(page);
    await signIn(page);
    await openPalette(page);
    await page.locator(S.paletteInput).fill('Sign out');
    await expect(page.locator(`${S.paletteSelected} kbd`)).toHaveText('Ada Lovelace');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.toast)).toHaveText('Signed out');
    const rows = await openAndList(page);
    expect(rows).toContain('Sign in');
    expect(rows).not.toContain('My pastes');
  });

  test('keeps the unsaved text across the sign-in round trip', async ({ page }) => {
    await start(page);
    await page.locator(S.editor).fill('half-written note');
    await runCommand(page, 'Sign in');
    await expect(page.locator(S.editor)).toHaveValue('half-written note');
  });

  test('reports a failed sign-in once', async ({ page }) => {
    await setupMockApi(page, { auth: true });
    await page
      .context()
      .addCookies([{ name: 'pb_flash', value: 'denied', url: 'http://localhost:5173' }]);
    await page.goto('/');
    await expect(page.locator(S.toast)).toHaveText('This account may not sign in here.');
    expect((await page.context().cookies()).some((c) => c.name === 'pb_flash')).toBe(false);
  });
});

test.describe('Private pastes and My pastes', () => {
  let store: MockStore;

  test.beforeEach(async ({ page }) => {
    store = await start(page);
    await signIn(page);
  });

  test('Make private toggles like burn, and the two exclude each other', async ({ page }) => {
    await page.locator(S.editor).fill('only for me');
    await runCommand(page, 'Make private');
    await expect(page.locator(S.toast)).toContainText('Next save is private');
    await expect(page.locator('#island .island-save svg')).toHaveAttribute('data-icon', 'lock');

    await runCommand(page, 'Burn after reading');
    await expect(page.locator('#island .island-save svg')).toHaveAttribute('data-icon', 'burn');
    const rows = await openAndList(page);
    expect(rows).toContain('Make private');
    await closePalette(page);

    await runCommand(page, 'Make private');
    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    expect(store.lastSaveParams()?.get('private')).toBe('1');
    expect(store.lastSaveParams()?.get('burn')).toBeNull();
    // Recent keeps a placeholder, not the text.
    expect((await recent(page))[0]).toMatchObject({ preview: 'Private paste', private: true });
  });

  test('My pastes lists own pastes and opens one', async ({ page }) => {
    await savePaste(page, 'first paste');
    await runCommand(page, 'New paste');
    await savePaste(page, 'second paste');

    await runCommand(page, 'My pastes');
    await expect(page.locator('#island .island-crumb')).toHaveText('My pastes');
    await expect(page.locator(`${S.paletteRow} > span`)).toHaveText([
      'second paste',
      'first paste',
    ]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.viewer)).toContainText('first paste');
  });

  test('Delete paste asks, then deletes and starts a new paste', async ({ page }) => {
    await savePaste(page, 'delete me');
    const key = store.lastKey()!;
    await runCommand(page, 'Delete paste');
    await expect(page.locator('#island .island-prompt-confirm')).toHaveText('Delete');
    await page.locator('#island .island-prompt-confirm').click();
    await expect(page.locator(S.toast)).toHaveText('Paste deleted');
    await expect(page.locator(S.editor)).toBeVisible();
    expect(store.get(key)).toBeUndefined();
    expect((await recent(page)).some((e: { key: string }) => e.key === key)).toBe(false);
  });

  test('Delete paste is offered for own pastes only', async ({ page }) => {
    store.set('foreign', 'not mine');
    await page.goto('/foreign');
    await expect(page.locator(S.viewer)).toContainText('not mine');
    await openPalette(page);
    await page.locator(S.paletteInput).fill('Delete');
    await expect(paletteLabel(page, 'Delete paste')).toHaveCount(0);
  });

  test('signed out, an own private paste is a 404 that stays in Recent', async ({ page }) => {
    await page.locator(S.editor).fill('private plan');
    await runCommand(page, 'Make private');
    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    const key = store.lastKey()!;

    await runCommand(page, 'Sign out');
    await page.goto(`/${key}`);
    await expect(page.locator(S.toast)).toContainText('sign in to open it');
    expect((await recent(page)).some((e: { key: string }) => e.key === key)).toBe(true);
  });
});
