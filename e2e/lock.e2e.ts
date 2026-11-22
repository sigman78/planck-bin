import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { expectCommand, runCommand } from './helpers/palette';

const PROMPT = `${S.island} .island-prompt`;
const TITLE = `${PROMPT} .island-prompt-title`;
const SECRET = `${PROMPT} .island-prompt-secret`;
const FIELD = `${PROMPT} .island-prompt-input`;
const CONFIRM = `${PROMPT} .island-prompt-confirm`;
const CANCEL = `${PROMPT} .island-prompt-cancel`;
const TEXT = 'const answer = 42;';

async function typePaste(page: Page, text = TEXT) {
  await page.goto('/');
  await page.locator(S.editor).fill(text);
}

/** Save with Ctrl+S and wait until the paste is presented; returns its key. */
async function save(page: Page, store: Awaited<ReturnType<typeof setupMockApi>>) {
  await page.keyboard.press('Control+s');
  await expect(page.locator(S.viewer)).toContainText(TEXT);
  return store.lastKey()!;
}

async function setOwnPassphrase(page: Page, passphrase: string) {
  await runCommand(page, 'Set own passphrase');
  await expect(page.locator(FIELD)).toBeFocused();
  await page.locator(FIELD).fill(passphrase);
  await page.keyboard.press('Enter');
  await expect(page.locator(S.island)).not.toHaveClass(/prompting/);
}

test.describe('protected pastes', () => {
  test('generated passphrase: shown once, opens the paste in any spelling', async ({ page }) => {
    const store = await setupMockApi(page);
    await typePaste(page);
    await runCommand(page, 'Protect with passphrase');
    await expect(page.locator(`${S.saveBtn} svg[data-icon="lock"]`)).toHaveCount(1);

    const key = await save(page, store);
    await expect(page.locator(TITLE)).toHaveText('Passphrase');
    const passphrase = (await page.locator(SECRET).textContent()) ?? '';
    expect(passphrase).toMatch(/^[a-z]+(-[a-z]+){3,}$/);

    // The server only ever sees ciphertext.
    expect(store.isLocked(key)).toBe(true);
    expect(store.get(key)).toMatch(/^v1\./);
    expect(store.get(key)).not.toContain('answer');

    await page.locator(CANCEL).click(); // Done
    await expect(page.locator(S.island)).not.toHaveClass(/prompting/);
    await expectCommand(page, 'Copy passphrase', true);
    await expectCommand(page, 'View raw', false);

    // A recipient: a fresh load of the link asks first and shows nothing.
    await page.goto(`/${key}`);
    await expect(page.locator(TITLE)).toHaveText('Protected paste');
    await expect(page.locator(FIELD)).toBeFocused();
    await expect(page.locator(S.viewer)).toBeHidden();

    // It has to be answered: Escape does not dismiss it.
    await page.keyboard.press('Escape');
    await expect(page.locator(S.island)).toHaveClass(/prompting/);

    await page.locator(FIELD).fill('not the passphrase');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.toast)).toContainText('Wrong passphrase: 9 attempts left');
    await expect(page.locator(FIELD)).toBeFocused();
    expect(store.lockFailures(key)).toBe(1);

    await page.locator(FIELD).fill(passphrase.toUpperCase().replaceAll('-', ' '));
    await page.locator(CONFIRM).click();
    await expect(page.locator(S.viewer)).toContainText(TEXT);
    await expect(page.locator(S.island)).not.toHaveClass(/prompting/);
    await expectCommand(page, 'Copy passphrase', false);
  });

  test('own passphrase with burn after reading: one unlock deletes it', async ({ page }) => {
    const store = await setupMockApi(page);
    await typePaste(page);

    // Escape dismisses the own-passphrase question; too short is refused.
    await runCommand(page, 'Set own passphrase');
    await page.keyboard.press('Escape');
    await expect(page.locator(S.island)).not.toHaveClass(/prompting/);
    await runCommand(page, 'Set own passphrase');
    await page.locator(FIELD).fill('short');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.toast)).toContainText('at least 8 characters');
    await expect(page.locator(S.island)).toHaveClass(/prompting/);
    await page.locator(CANCEL).click();

    await setOwnPassphrase(page, 'open sesame please');
    await runCommand(page, 'Burn after reading');
    const key = await save(page, store);
    await expect(page.locator(S.toast)).toContainText('Protected burn link ready');
    await expect(page.locator(S.island)).not.toHaveClass(/prompting/);

    await page.goto(`/${key}`);
    await expect(page.locator(`${PROMPT} .island-prompt-text`)).toContainText('deletes it');
    await expect(page.locator(CONFIRM)).toHaveText('Unlock and burn');
    // A plain load never consumes it.
    expect(store.get(key)).toBeDefined();

    await page.locator(FIELD).fill('Open-Sesame-Please');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.viewer)).toContainText(TEXT);
    await expect(page.locator(S.toast)).toContainText('this tab holds the only copy');
    expect(store.get(key)).toBeUndefined();
  });

  test('the tenth wrong passphrase deletes the paste', async ({ page }) => {
    const store = await setupMockApi(page);
    await typePaste(page);
    await setOwnPassphrase(page, 'correct horse battery');
    const key = await save(page, store);

    await page.goto(`/${key}`);
    for (let left = 9; left >= 1; left--) {
      await page.locator(FIELD).fill(`wrong guess ${left}`);
      await page.keyboard.press('Enter');
      await expect(page.locator(S.toast)).toContainText(
        `Wrong passphrase: ${left} ${left === 1 ? 'attempt' : 'attempts'} left`
      );
      await expect(page.locator(CONFIRM)).toBeEnabled();
    }
    await page.locator(FIELD).fill('wrong guess 0');
    await page.keyboard.press('Enter');
    await expect(page.locator(S.toast)).toContainText('Too many wrong passphrases');
    await expect(page.locator(S.editor)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    expect(store.get(key)).toBeUndefined();
  });
});
