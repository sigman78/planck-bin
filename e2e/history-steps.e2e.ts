import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';

/**
 * Back/forward steps. A step the browser already animated (Safari's swipe,
 * reported through hasUAVisualTransition) must render in place before the
 * next frame: no page transition of our own and no refetch, so the live page
 * matches the browser's snapshot when the gesture hands over to it.
 */
async function track(page: Page) {
  const fetches: string[] = [];
  page.on('request', (req) => {
    if (/\/documents\/[^/]+$/.test(req.url()) && req.method() === 'GET') {
      fetches.push(new URL(req.url()).pathname);
    }
  });
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
  return {
    fetches,
    vtCalls: () => page.evaluate(() => (window as unknown as { __vtCalls: number }).__vtCalls),
  };
}

/** Push `path` and dispatch the popstate a history step would, optionally browser-animated. */
function step(page: Page, path: string, browserAnimated?: boolean) {
  return page.evaluate(
    async ({ path, browserAnimated }) => {
      history.pushState(null, '', path);
      const evt = new PopStateEvent('popstate', { state: null });
      if (browserAnimated !== undefined) {
        Object.defineProperty(evt, 'hasUAVisualTransition', { value: browserAnimated });
      }
      dispatchEvent(evt);
      // What the next frame paints: the viewer text once rAF callbacks run.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return document.querySelector('#viewer code')?.textContent ?? '';
    },
    { path, browserAnimated }
  );
}

test.describe('History steps', () => {
  test('a browser-animated step renders in place: no transition, no refetch', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('alpha', 'first paste');
    store.set('beta', 'second paste');
    const seen = await track(page);

    await page.goto('/alpha');
    await expect(page.locator(`${S.viewer} code`)).toHaveText('first paste');
    await step(page, '/beta', false);
    await expect(page.locator(`${S.viewer} code`)).toHaveText('second paste');
    const before = await seen.vtCalls();

    // Swipe back to a paste seen before: rendered by the next frame, from memory.
    expect(await step(page, '/alpha', true)).toBe('first paste');
    expect(await seen.vtCalls()).toBe(before);
    expect(seen.fetches).toEqual(['/documents/alpha', '/documents/beta']);
  });

  test('a browser-animated step to the editor skips the transition too', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('alpha', 'first paste');
    const seen = await track(page);

    await page.goto('/alpha');
    await expect(page.locator(`${S.viewer} code`)).toHaveText('first paste');
    const before = await seen.vtCalls();

    await step(page, '/', true);
    await expect(page.locator(S.editor)).toBeVisible();
    expect(await seen.vtCalls()).toBe(before);
  });

  test('an ordinary back step keeps the page transition and uses memory', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('alpha', 'first paste');
    store.set('beta', 'second paste');
    const seen = await track(page);

    await page.goto('/alpha');
    await expect(page.locator(`${S.viewer} code`)).toHaveText('first paste');
    await step(page, '/beta');
    await expect(page.locator(`${S.viewer} code`)).toHaveText('second paste');
    const before = await seen.vtCalls();

    await page.goBack(); // a real popstate; Chromium reports no browser animation
    await expect(page.locator(`${S.viewer} code`)).toHaveText('first paste');
    expect(await seen.vtCalls()).toBe(before + 1);
    expect(seen.fetches).toEqual(['/documents/alpha', '/documents/beta']);
  });
});
