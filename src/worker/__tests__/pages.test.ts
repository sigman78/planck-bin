/** @jest-environment node */

import { Hono } from 'hono';
import { createPageHandler, MAX_RENDER_CHARS, parseDocumentRoute } from '../pages';
import { VIEWER_ANCHOR } from '../render';
import type { Env } from '../types';
import { fakeEnv, type FakeEnvOptions } from '../__fakes__/env';
import { EMBEDDED_DOCUMENT_ID } from '../../shared/types';

const SHELL = '<html><head><title>hastebin</title></head><body>' + VIEWER_ANCHOR + '</body></html>';

const NOW = Math.floor(Date.now() / 1000);
const base: FakeEnvOptions = {
  rows: {
    'tavelu-hasoq': { content: 'a < b', created_at: NOW, expires_at: null },
    big: { content: 'x'.repeat(MAX_RENDER_CHARS + 1), created_at: NOW, expires_at: null },
  },
  assets: { '/index.html': SHELL, '/_about.md': '# About' },
  vars: { SERVER_RENDER: 'true' } as Partial<Env>,
};

const app = new Hono<{ Bindings: Env }>();
app.get('*', createPageHandler({ appName: 'Haste' }));

const HTML = { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } };

async function page(path: string, options: FakeEnvOptions = {}, init: RequestInit = HTML) {
  const { env, lookups, ctx } = fakeEnv({ ...base, ...options });
  const res = await app.request(path, init, env, ctx);
  return { res, html: await res.text(), lookups };
}

describe('parseDocumentRoute', () => {
  it('splits like the client: key before the first dot, one segment only', () => {
    expect(parseDocumentRoute('/abc.tar.gz')).toEqual({ key: 'abc', displayName: 'abc.tar.gz' });
    expect(parseDocumentRoute('/abc')).toEqual({ key: 'abc', displayName: 'abc' });
    expect(parseDocumentRoute('/')).toBeNull();
    expect(parseDocumentRoute('/abc.js/fork')).toBeNull();
    expect(parseDocumentRoute('/.hidden')).toBeNull();
  });
});

describe('page handler', () => {
  it('renders a paste page with the embedded document', async () => {
    const { res, html } = await page('/tavelu-hasoq.c');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('ETag')).toBeNull();
    expect(html).toContain('<code class="hljs">a &lt; b</code>');
    expect(html).toContain(`id="${EMBEDDED_DOCUMENT_ID}"`);
    expect(html).toContain('<title>Haste - tavelu-hasoq</title>');
  });

  it('serves the plain shell when the flag is off', async () => {
    const { html, lookups } = await page('/tavelu-hasoq.c', { vars: {} });
    expect(html).toBe(SHELL);
    expect(lookups).toEqual([]);
  });

  it.each([
    ['a missing paste', '/nosuchkey', {}],
    ['a key that cannot exist', '/a%21b', {}],
    ['a nested path', '/tavelu-hasoq.c/fork', {}],
    ['a rate-limited client', '/tavelu-hasoq', { readAllowed: false }],
    ['a storage failure', '/tavelu-hasoq', { dbError: true }],
    ['a paste over the render size cap', '/big', {}],
  ])('falls back to the plain shell for %s', async (_name, path, options) => {
    const { res, html } = await page(path, options);
    expect(res.status).toBe(200);
    expect(html).toBe(SHELL);
  });

  it('serves the plain shell to non-page requests (e.g. the favicon) without storage', async () => {
    const { html, lookups } = await page('/favicon.ico', {}, { headers: { Accept: 'image/*' } });
    expect(html).toBe(SHELL);
    expect(lookups).toEqual([]);
  });

  it('does not query storage for paths that cannot be keys', async () => {
    const { lookups } = await page('/a%21b');
    expect(lookups).toEqual([]);
  });

  it('renders the about page as a frozen built-in', async () => {
    const { html, lookups } = await page('/about.md');
    expect(html).toContain('"frozen":true');
    expect(html).toContain('# About');
    expect(lookups).toEqual([]);
  });

  it('serves the root as the plain shell', async () => {
    const { html } = await page('/');
    expect(html).toBe(SHELL);
  });
});
