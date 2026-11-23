/** @jest-environment node */

import { api } from '../api';
import { fakeEnv } from '../__fakes__/env';

const NOW = Math.floor(Date.now() / 1000);
const rows = {
  'tavelu-hasoq': { content: 'int main() {}\n', created_at: NOW - 60, expires_at: NOW + 3600 },
  forever: { content: 'kept', created_at: NOW - 60, expires_at: null },
};
const assets = { '/_about.md': '# About\n' };

function get(path: string, init?: RequestInit, opts = {}) {
  const { env, lookups, ctx } = fakeEnv({ rows, assets, ...opts });
  return { lookups, response: api.request(path, init, env, ctx) };
}

describe('GET /documents/:id', () => {
  it('returns content with ISO timestamps and an ETag', async () => {
    const { response } = get('/documents/tavelu-hasoq');
    const res = await response;
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(`"tavelu-hasoq-${NOW - 60}"`);
    await expect(res.json()).resolves.toEqual({
      key: 'tavelu-hasoq',
      content: 'int main() {}\n',
      createdAt: new Date((NOW - 60) * 1000).toISOString(),
      expiresAt: new Date((NOW + 3600) * 1000).toISOString(),
    });
  });

  it('answers a matching If-None-Match with 304', async () => {
    const etag = `"tavelu-hasoq-${NOW - 60}"`;
    const res = await get('/documents/tavelu-hasoq', { headers: { 'If-None-Match': `W/${etag}` } })
      .response;
    expect(res.status).toBe(304);
    expect(res.headers.get('ETag')).toBe(etag);
  });

  it('rejects malformed keys without touching storage', async () => {
    const { response, lookups } = get(`/documents/${'a'.repeat(65)}`);
    expect((await response).status).toBe(404);
    const bad = get('/documents/a.b');
    expect((await bad.response).status).toBe(404);
    expect([...lookups, ...bad.lookups]).toEqual([]);
  });

  it('returns 404 for a missing document', async () => {
    const res = await get('/documents/nosuchkey').response;
    expect(res.status).toBe(404);
  });

  it('serves the about page as a frozen built-in with null timestamps', async () => {
    const { response, lookups } = get('/documents/about');
    const res = await response;
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      key: 'about',
      content: '# About\n',
      frozen: true,
      createdAt: null,
      expiresAt: null,
    });
    expect(res.headers.get('ETag')).toMatch(/^"about-[0-9a-f]+"$/);
    expect(lookups).toEqual([]);
  });

  it('reports storage failures as 500', async () => {
    const res = await get('/documents/tavelu-hasoq', undefined, { dbError: true }).response;
    expect(res.status).toBe(500);
  });

  it('serves HEAD like GET without a body', async () => {
    const res = await get('/documents/tavelu-hasoq', { method: 'HEAD' }).response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('GET /raw/:id', () => {
  it('serves stored content as plain text', async () => {
    const res = await get('/raw/forever').response;
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('kept');
  });

  it('serves the about page too', async () => {
    const res = await get('/raw/about').response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# About\n');
  });
});

describe('cache headers', () => {
  // Hono's test requests carry no `cf` object, which the API treats as local dev.
  it('uses no-cache in local dev', async () => {
    const res = await get('/documents/forever').response;
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});

describe('method handling', () => {
  it.each([
    ['PUT', '/documents', 'GET, HEAD, POST'],
    ['PUT', '/documents/tavelu-hasoq', 'GET, HEAD, DELETE'],
    ['POST', '/raw/tavelu-hasoq', 'GET, HEAD'],
  ])('%s %s is 405 with Allow: %s', async (method, path, allow) => {
    const res = await get(path, { method }).response;
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe(allow);
  });
});

describe('POST /documents', () => {
  it('treats the media type case-insensitively', async () => {
    const res = await get('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'Application/JSON; charset=utf-8' },
      body: JSON.stringify({ content: 'hello' }),
    }).response;
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string };
    expect(Object.keys(body)).toEqual(['key', 'expiresAt']);
  });

  describe('storage budget (MAX_STORAGE_MB)', () => {
    const MB = 1024 * 1024;
    const post = (vars: Record<string, string>, sizeAfter: number) => {
      const { env, ctx, writes } = fakeEnv({ vars: vars as never, sizeAfter });
      const response = api.request('/documents', { method: 'POST', body: 'hello' }, env, ctx);
      return { response, writes };
    };

    it('refuses new pastes with 507 once the database reaches the budget', async () => {
      const { response, writes } = post({ MAX_STORAGE_MB: '5' }, 5 * MB);
      const res = await response;
      expect(res.status).toBe(507);
      expect(writes.some((sql) => /INSERT/.test(sql))).toBe(false);
    });

    it('accepts pastes below the budget', async () => {
      expect((await post({ MAX_STORAGE_MB: '5' }, 5 * MB - 1).response).status).toBe(201);
    });

    it('is off by default and does not query the size', async () => {
      const { response, writes } = post({}, 100 * 1024 * MB);
      expect((await response).status).toBe(201);
      expect(writes).not.toContain('SELECT 1');
    });
  });
});
