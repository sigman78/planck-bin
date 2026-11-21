/** @jest-environment node */

import { Hono } from 'hono';
import { api, parseCreateOptions } from '../api';
import { capExpireDays } from '../config';
import { createPageHandler } from '../pages';
import { VIEWER_ANCHOR } from '../render';
import type { Env } from '../types';
import { fakeEnv, type FakeEnvOptions, type FakeRow } from '../__fakes__/env';
import { LIFETIMES } from '../../shared/types';

const NOW = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;
const SECRET = 'the launch code';

/** Fresh rows per test: take() deletes from the table. */
function burnRows(): Record<string, FakeRow> {
  return {
    secret: { content: SECRET, created_at: NOW - 60, expires_at: NOW + DAY, burn: 1 },
    stale: { content: SECRET, created_at: NOW - 60, expires_at: NOW - 1, burn: 1 },
    plain: { content: 'plain', created_at: NOW - 60, expires_at: null },
  };
}

function setup(options: FakeEnvOptions = {}) {
  const fake = fakeEnv({ rows: burnRows(), ...options });
  const request = (path: string, init?: RequestInit) => api.request(path, init, fake.env, fake.ctx);
  return { ...fake, request };
}

function insertArgs(runs: { sql: string; args: unknown[] }[]) {
  const insert = runs.find((r) => /INSERT/.test(r.sql));
  if (!insert) throw new Error('no INSERT');
  const [, , createdAt, expiresAt, burn] = insert.args as [string, string, number, number, number];
  return { createdAt, expiresAt, burn };
}

describe('parseCreateOptions', () => {
  const parse = (query: string) => parseCreateOptions(new URLSearchParams(query));

  it('defaults to nothing when no options are given', () => {
    expect(parse('')).toEqual({});
  });

  it.each(Object.entries(LIFETIMES))('maps expires=%s to %d days', (id, days) => {
    expect(parse(`expires=${id}`)).toEqual({ expireDays: days });
  });

  it('accepts burn flags', () => {
    expect(parse('burn=1')).toEqual({ burn: true });
    expect(parse('burn=true')).toEqual({ burn: true });
    expect(parse('burn=0')).toEqual({});
  });

  it.each(['expires=2d', 'expires=', 'expires=toString', 'burn=yes'])('rejects %s', (q) => {
    expect(parse(q)).toHaveProperty('error');
  });
});

describe('capExpireDays', () => {
  it('passes everything through without a cap', () => {
    expect(capExpireDays(0, 0)).toBe(0);
    expect(capExpireDays(180, 0)).toBe(180);
  });

  it('clamps long and permanent lifetimes to the cap', () => {
    expect(capExpireDays(180, 30)).toBe(30);
    expect(capExpireDays(0, 30)).toBe(30);
    expect(capExpireDays(3, 30)).toBe(3);
  });
});

describe('POST /documents with options', () => {
  const post = (query: string, vars: Partial<Env> = {}, init: RequestInit = {}) => {
    const fake = setup({ vars });
    const response = fake.request(`/documents${query}`, { method: 'POST', body: 'x', ...init });
    return { ...fake, response };
  };

  it('stores the chosen lifetime and reports it', async () => {
    const { response, runs } = post('?expires=3d');
    const res = await response;
    expect(res.status).toBe(201);
    const { createdAt, expiresAt, burn } = insertArgs(runs);
    expect(expiresAt - createdAt).toBe(3 * DAY);
    expect(burn).toBe(0);
    const body = (await res.json()) as { expiresAt: string; burn?: boolean };
    expect(body.expiresAt).toBe(new Date(expiresAt * 1000).toISOString());
    expect(body.burn).toBeUndefined();
  });

  it('uses DEFAULT_EXPIRE_DAYS without an expires option', async () => {
    const { response, runs } = post('', { DEFAULT_EXPIRE_DAYS: '7' });
    expect((await response).status).toBe(201);
    const { createdAt, expiresAt } = insertArgs(runs);
    expect(expiresAt - createdAt).toBe(7 * DAY);
  });

  it('stores never as NULL and reports null', async () => {
    const { response, runs } = post('?expires=never');
    const res = await response;
    expect(insertArgs(runs).expiresAt).toBeNull();
    expect(((await res.json()) as { expiresAt: unknown }).expiresAt).toBeNull();
  });

  it('clamps to MAX_EXPIRE_DAYS', async () => {
    const { response, runs } = post('?expires=never', { MAX_EXPIRE_DAYS: '30' });
    expect((await response).status).toBe(201);
    const { createdAt, expiresAt } = insertArgs(runs);
    expect(expiresAt - createdAt).toBe(30 * DAY);
  });

  it('stores the burn flag and reports it', async () => {
    const { response, runs } = post('?burn=1&expires=1w');
    const res = await response;
    expect(insertArgs(runs).burn).toBe(1);
    expect(((await res.json()) as { burn?: boolean }).burn).toBe(true);
  });

  it('takes options with a JSON body too', async () => {
    const { response, runs } = post(
      '?burn=1',
      {},
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      }
    );
    expect((await response).status).toBe(201);
    expect(insertArgs(runs).burn).toBe(1);
  });

  it.each(['?expires=forever', '?burn=maybe'])('rejects %s with 400 and no insert', async (q) => {
    const { response, writes } = post(q);
    const res = await response;
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toHaveProperty('message');
    expect(writes.some((sql) => /INSERT/.test(sql))).toBe(false);
  });
});

describe('expired documents', () => {
  it.each(['/documents/stale', '/raw/stale'])('%s is 404 before cleanup runs', async (path) => {
    const { request, rows } = setup();
    rows.stale.burn = 0;
    expect((await request(path)).status).toBe(404);
  });
});

describe('burn after reading', () => {
  it('GET /documents/:id returns it once, uncached, then 404', async () => {
    const { request, rows } = setup();
    const res = await request('/documents/secret');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('ETag')).toBeNull();
    await expect(res.json()).resolves.toMatchObject({ key: 'secret', content: SECRET, burn: true });
    expect(rows.secret).toBeUndefined();
    expect((await request('/documents/secret')).status).toBe(404);
  });

  it('GET /raw/:id returns it once, then 404', async () => {
    const { request } = setup();
    const res = await request('/raw/secret');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe(SECRET);
    expect((await request('/raw/secret')).status).toBe(404);
  });

  it('?peek=1 reports it without content and leaves it in place', async () => {
    const { request, rows, contentChars } = setup();
    const res = await request('/documents/secret?peek=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ key: 'secret', burnPending: true });
    expect(contentChars()).toBe(0);
    expect(rows.secret).toBeDefined();
  });

  it.each(['/documents/secret', '/raw/secret'])('HEAD %s does not consume', async (path) => {
    const { request, rows } = setup();
    expect((await request(path, { method: 'HEAD' })).status).toBe(200);
    expect(rows.secret).toBeDefined();
  });

  it('never answers 304', async () => {
    const { request } = setup();
    const res = await request('/documents/secret', { headers: { 'If-None-Match': '*' } });
    expect(res.status).toBe(200);
  });

  it('an expired burn paste is 404 and stays unread', async () => {
    const { request, contentChars } = setup();
    expect((await request('/documents/stale')).status).toBe(404);
    expect(contentChars()).toBe(0);
  });

  it('does not count views', async () => {
    const { request, writes } = setup({ vars: { COUNT_VIEWS: 'true' } as Partial<Env> });
    expect((await request('/documents/secret')).status).toBe(200);
    expect(writes.some((sql) => /views/.test(sql))).toBe(false);
  });

  it('normal pastes are never deleted by a read', async () => {
    const { request, rows } = setup();
    expect((await request('/documents/plain')).status).toBe(200);
    expect(rows.plain).toBeDefined();
  });
});

describe('burn page render', () => {
  const SHELL =
    '<html><head><title>Planck Bin</title></head><body>' + VIEWER_ANCHOR + '</body></html>';
  const app = new Hono<{ Bindings: Env }>();
  app.get('*', createPageHandler({ appName: 'Planck Bin' }));

  async function page(path: string) {
    const fake = fakeEnv({
      rows: burnRows(),
      assets: { '/index.html': SHELL },
      vars: { SERVER_RENDER: 'true' } as Partial<Env>,
    });
    const res = await app.request(path, { headers: { Accept: 'text/html' } }, fake.env, fake.ctx);
    return { res, html: await res.text(), ...fake };
  }

  it('embeds only a marker, never the content, and consumes nothing', async () => {
    const { res, html, rows, contentChars } = await page('/secret.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('"burnPending":true');
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain('og:title');
    expect(html).toContain(VIEWER_ANCHOR);
    expect(contentChars()).toBe(0);
    expect(rows.secret).toBeDefined();
  });
});
