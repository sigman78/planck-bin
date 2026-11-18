import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { S } from './helpers/selectors';
import { syntaxHighlightCount, paintedTexts } from './helpers/syntax';
import { expectCommand } from './helpers/palette';
import { renderDocumentPage, renderNotFoundPage } from '../src/worker/render';
import type { GetResponse } from '../src/shared/types';

/**
 * The client half of SERVER_RENDER. The dev server has no worker, so the
 * navigation is answered with the dev shell passed through the worker's own
 * renderer, exactly what the worker sends in production.
 */
async function serveRendered(page: Page, path: string, doc: GetResponse) {
  await page.route(`**${path}`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const shell = await (
      await route.fetch({ url: new URL('/', route.request().url()).href })
    ).text();
    const html = renderDocumentPage(shell, {
      appName: 'Planck Bin',
      displayName: path.slice(1),
      doc,
    });
    expect(html, 'dev shell lost a render anchor').not.toBeNull();
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html! });
  });
}

/** Answer the navigation with the worker's 404 page for a confirmed-missing key. */
async function serveNotFound(page: Page, path: string, key: string) {
  await page.route(`**${path}`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const shell = await (
      await route.fetch({ url: new URL('/', route.request().url()).href })
    ).text();
    const html = renderNotFoundPage(shell, key);
    expect(html, 'dev shell lost a render anchor').not.toBeNull();
    await route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8', body: html! });
  });
}

/** Count /documents GETs and whether the viewer was ever blanked for loading. */
async function watch(page: Page) {
  const fetches: string[] = [];
  page.on('request', (req) => {
    if (/\/documents\//.test(req.url()) && req.method() === 'GET') fetches.push(req.url());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __blanked: boolean };
    w.__blanked = false;
    new MutationObserver(() => {
      if (document.getElementById('viewer')?.classList.contains('is-loading')) w.__blanked = true;
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  return {
    fetches,
    blanked: () => page.evaluate(() => (window as unknown as { __blanked: boolean }).__blanked),
  };
}

const HOSTILE = 'const s = "</script><b>x</b>";\nconst t = "$&" + `$\'`;\n';

test.describe('Server-rendered paste page', () => {
  test('shows the embedded paste, highlighted, without fetching it', async ({ page }) => {
    await setupMockApi(page);
    const seen = await watch(page);
    await serveRendered(page, '/tavelu-hasoq.js', { key: 'tavelu-hasoq', content: HOSTILE });

    await page.goto('/tavelu-hasoq.js');
    await expect(page.locator(S.island)).toHaveAttribute('data-mode', 'presenting');
    await expect.poll(() => paintedTexts(page)).toContain('const');
    // The server-rendered text node is kept: no per-token elements.
    expect(await page.locator(`${S.viewer} code`).evaluate((el) => el.childNodes.length)).toBe(1);
    await expect(page.locator(`${S.viewer} code`)).toHaveText(HOSTILE);
    await expect(page.locator(`${S.viewer} b`)).toHaveCount(0);

    expect(seen.fetches).toEqual([]);
    expect(await seen.blanked()).toBe(false);
    expect(page.url()).toMatch(/\/tavelu-hasoq\.js$/);
    await expect(page).toHaveTitle('Planck Bin - tavelu-hasoq');
  });

  test('a CRLF paste keeps the server text node and selects as LF', async ({ page }) => {
    await setupMockApi(page);
    // No trailing newline: Selection.toString() drops a final one anyway.
    const content = 'const a = 1;\r\n// note\r\nconst b = 2;';
    await serveRendered(page, '/tavelu-hasoq.js', { key: 'tavelu-hasoq', content });

    await page.goto('/tavelu-hasoq.js');
    await expect.poll(() => paintedTexts(page)).toContain('// note');
    const shown = await page.locator(`${S.viewer} code`).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return {
        nodes: el.childNodes.length,
        hasCR: el.textContent!.includes('\r'),
        selected: selection.toString(),
      };
    });
    expect(shown).toEqual({ nodes: 1, hasCR: false, selected: content.replace(/\r\n/g, '\n') });
  });

  test('the URL extension still picks the language', async ({ page }) => {
    await setupMockApi(page);
    await serveRendered(page, '/tavelu-hasoq.txt', { key: 'tavelu-hasoq', content: HOSTILE });

    await page.goto('/tavelu-hasoq.txt');
    await expect(page.locator(`${S.viewer} code`)).toHaveText(HOSTILE);
    expect(await syntaxHighlightCount(page)).toBe(0);
  });

  test('a later navigation fetches as usual', async ({ page }) => {
    const store = await setupMockApi(page);
    store.set('other', 'second paste');
    const seen = await watch(page);
    await serveRendered(page, '/tavelu-hasoq.js', { key: 'tavelu-hasoq', content: 'first paste' });

    await page.goto('/tavelu-hasoq.js');
    await expect(page.locator(`${S.viewer} code`)).toHaveText('first paste');
    await page.evaluate(() => {
      history.pushState(null, '', '/other');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator(`${S.viewer} code`)).toHaveText('second paste');
    expect(seen.fetches.map((u) => new URL(u).pathname)).toEqual(['/documents/other']);
  });

  test('the about page stays frozen: no duplicate, not recorded', async ({ page }) => {
    await setupMockApi(page);
    await serveRendered(page, '/about.md', { key: 'about', content: '# About\n', frozen: true });

    await page.goto('/about.md');
    await expect(page.locator(`${S.viewer} code`)).toContainText('# About');
    await expectCommand(page, 'Duplicate & edit', false);
    const recents = await page.evaluate(() => JSON.stringify(localStorage));
    expect(recents).not.toContain('about');
  });

  test('a missing paste shows "not found" without a second lookup', async ({ page }) => {
    await setupMockApi(page);
    const seen = await watch(page);
    await serveNotFound(page, '/gone-paste.js', 'gone-paste');
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(
        'haste-recent',
        JSON.stringify([
          { key: 'gone-paste', path: '/gone-paste.js', preview: 'x', at: Date.now() },
        ])
      );
    });

    await page.goto('/gone-paste.js');
    await expect(page.locator(S.toast)).toHaveText('Document not found.');
    await expect(page.locator(S.island)).toHaveAttribute('data-mode', 'editing');
    expect(new URL(page.url()).pathname).toBe('/');
    expect(seen.fetches).toEqual([]);
    // The confirmed miss also drops the stale entry from the recent list.
    const recents = await page.evaluate(() => localStorage.getItem('haste-recent') ?? '');
    expect(recents).not.toContain('gone-paste');
  });
});
