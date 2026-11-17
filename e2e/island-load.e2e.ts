import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';

/**
 * The island's initial state (hint stage from storage, mode from the URL,
 * Save from a restored draft) must appear as-is on load, not animate in from
 * the markup defaults. Records every CSS transition started inside the island.
 */
async function recordIslandTransitions(page: Page, storage: Record<string, string>) {
  await page.addInitScript((items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    const seen: string[] = [];
    (window as unknown as { __islandTransitions: string[] }).__islandTransitions = seen;
    document.addEventListener('transitionrun', (e) => {
      const target = e.target as Element;
      if (target.closest('#island'))
        seen.push(`${target.getAttribute('class') ?? target.tagName} ${e.propertyName}`);
    });
  }, storage);
}

const islandTransitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { __islandTransitions: string[] }).__islandTransitions);

/** The island's own fade-in on settle is expected; nothing else may animate. */
const FADE_IN = ['no-print opacity'];

test.describe('Island on page load', () => {
  test('a known-stage visit to a paste shows the settled pill without animating', async ({
    page,
  }) => {
    const store = await setupMockApi(page);
    store.set('abc', 'const a = 1;');
    await recordIslandTransitions(page, { 'haste-hint-stage': 'known' });

    await page.goto('/abc.js');
    await expect(page.locator(S.viewer)).toContainText('const a = 1;');
    await expect(page.locator(S.island)).toHaveAttribute('data-mode', 'presenting');
    await page.waitForTimeout(600);

    expect(await islandTransitions(page)).toEqual(FADE_IN);
  });

  test('a restored draft shows Save without sliding it in', async ({ page }) => {
    await setupMockApi(page);
    await recordIslandTransitions(page, { 'haste-hint-stage': 'known', 'haste-draft': 'draft' });

    await page.goto('/');
    await expect(page.locator(S.editor)).toHaveValue('draft');
    await expect(page.locator('#island .island-save')).toBeEnabled();
    await page.waitForTimeout(600);

    expect(await islandTransitions(page)).toEqual(FADE_IN);
  });

  test('the first render skips the page wipe; in-app navigation keeps it', async ({ page }) => {
    await setupMockApi(page);
    // Registered after the mock's stub, so this wraps it and counts calls.
    await page.addInitScript(() => {
      const w = window as unknown as { __vtCalls: number };
      w.__vtCalls = 0;
      const inner = document.startViewTransition?.bind(document);
      if (inner) {
        document.startViewTransition = ((cb?: () => void | Promise<void>) => {
          w.__vtCalls++;
          return inner(cb);
        }) as typeof document.startViewTransition;
      }
    });
    const vtCalls = () =>
      page.evaluate(() => (window as unknown as { __vtCalls: number }).__vtCalls);

    await page.goto('/');
    await expect(page.locator(S.editor)).toBeVisible();
    await expect(page.locator(S.island)).toHaveAttribute('data-settled', '');
    expect(await vtCalls()).toBe(0);

    await page.locator(S.editor).fill('hello');
    await page.locator(S.saveBtn).click();
    await expect(page.locator(S.viewer)).toBeVisible();
    expect(await vtCalls()).toBe(1);
  });

  test('before the app script runs, no view and no island is shown', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('abc', 'const a = 1;');
    let releaseScript!: () => void;
    const scriptHeld = new Promise<void>((resolve) => (releaseScript = resolve));
    await page.route('**/application.ts', async (route) => {
      await scriptHeld;
      await route.continue();
    });

    await page.goto('/abc.js', { waitUntil: 'commit' });
    await page.locator(S.editor).waitFor({ state: 'attached' });
    await expect(page.locator(S.editor)).toBeHidden();
    await expect(page.locator(S.viewer)).toBeHidden();
    await expect(page.locator(S.island)).toBeHidden();

    releaseScript();
    await expect(page.locator(S.viewer)).toContainText('const a = 1;');
    await expect(page.locator(S.island)).toBeVisible();
    await expect(page.locator(S.editor)).toBeHidden();
  });

  test('state changes after load still animate', async ({ page }) => {
    await setupMockApi(page);
    await recordIslandTransitions(page, { 'haste-hint-stage': 'known' });

    await page.goto('/');
    await expect(page.locator(S.editor)).toBeVisible();
    await page.waitForTimeout(300);
    await page.locator(S.editor).fill('x');

    await expect
      .poll(() => islandTransitions(page))
      .toContainEqual(expect.stringContaining('island-save'));
  });
});
