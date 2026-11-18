/** @jest-environment node */

import { Hono } from 'hono';
import { api } from '../api';
import { createPageHandler, MAX_RENDER_CHARS } from '../pages';
import { VIEWER_ANCHOR } from '../render';
import { fakeEnv, type FakeEnvOptions } from '../__fakes__/env';
import type { Env } from '../types';

const NOW = Math.floor(Date.now() / 1000);
const SHELL = '<html><head><title>t</title></head><body>' + VIEWER_ANCHOR + '</body></html>';
const ETAG = `"tavelu-hasoq-${NOW - 60}"`;
const base: FakeEnvOptions = {
  rows: {
    'tavelu-hasoq': { content: 'hello', created_at: NOW - 60, expires_at: null },
    big: { content: 'x'.repeat(MAX_RENDER_CHARS + 1), created_at: NOW, expires_at: null },
  },
  assets: { '/index.html': SHELL, '/_about.md': '# About' },
};
const COUNTING = { COUNT_VIEWS: 'true', SERVER_RENDER: 'true' } as Partial<Env>;

const app = new Hono<{ Bindings: Env }>();
app.route('/', api);
app.get('*', createPageHandler({ appName: 'Planck Bin' }));

async function viewWrites(path: string, init: RequestInit = {}, vars = COUNTING) {
  const { env, ctx, writes } = fakeEnv({ ...base, vars });
  const res = await app.request(path, init, env, ctx);
  await res.arrayBuffer();
  return {
    status: res.status,
    count: writes.filter((sql) => /views = views \+ 1/.test(sql)).length,
  };
}

const HTML = { headers: { Accept: 'text/html' } };

describe('view counting', () => {
  it('is off by default: reads never write', async () => {
    for (const path of ['/documents/tavelu-hasoq', '/raw/tavelu-hasoq']) {
      expect(await viewWrites(path, {}, {})).toEqual({ status: 200, count: 0 });
    }
    expect(
      await viewWrites('/tavelu-hasoq', HTML, { SERVER_RENDER: 'true' } as Partial<Env>)
    ).toEqual({ status: 200, count: 0 });
  });

  it('counts a full GET once when COUNT_VIEWS is on', async () => {
    expect(await viewWrites('/documents/tavelu-hasoq')).toEqual({ status: 200, count: 1 });
    expect(await viewWrites('/raw/tavelu-hasoq')).toEqual({ status: 200, count: 1 });
  });

  it('does not count revalidations (304)', async () => {
    const init = { headers: { 'If-None-Match': ETAG } };
    expect(await viewWrites('/documents/tavelu-hasoq', init)).toEqual({ status: 304, count: 0 });
  });

  it('does not count HEAD requests', async () => {
    expect(await viewWrites('/documents/tavelu-hasoq', { method: 'HEAD' })).toEqual({
      status: 200,
      count: 0,
    });
  });

  it('does not count built-in pages', async () => {
    expect(await viewWrites('/documents/about')).toEqual({ status: 200, count: 0 });
  });

  it('counts a server-rendered page, but not one that falls back to the shell', async () => {
    expect(await viewWrites('/tavelu-hasoq.txt', HTML)).toEqual({ status: 200, count: 1 });
    expect(await viewWrites('/big', HTML)).toEqual({ status: 200, count: 0 });
  });
});
