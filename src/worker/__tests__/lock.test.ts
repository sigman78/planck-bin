/** @jest-environment node */

import { Hono } from 'hono';
import { api } from '../api';
import { createPageHandler } from '../pages';
import { installRequestPolicy } from '../request-policy';
import { VIEWER_ANCHOR } from '../render';
import type { Env } from '../types';
import { fakeEnv } from '../__fakes__/env';
import { sqliteD1 } from '../__fakes__/sqlite-d1';
import { isLockSpec, sameVerifier, verifierOf } from '../locks';
import { lockContent, openLock } from '../../client/lock-crypto';
import { toBase64Url } from '../../shared/base64url';
import {
  EMBEDDED_DOCUMENT_ID,
  UNLOCK_ATTEMPTS,
  type GetResponse,
  type LockedPending,
  type SaveResponse,
  type UnlockRejected,
} from '../../shared/types';

const SHELL =
  '<html><head><title>Planck Bin</title></head><body>' + VIEWER_ANCHOR + '</body></html>';
const SECRET = 'int main() { return 42; }';
const PASSPHRASE = 'maple-orbit-quiet-lantern';

const app = new Hono<{ Bindings: Env }>();
installRequestPolicy(app);
app.route('/', api);
app.get('*', createPageHandler({ appName: 'Planck Bin' }));

function setup() {
  const sqlite = sqliteD1();
  const fake = fakeEnv({
    assets: { '/index.html': SHELL },
    vars: { DB: sqlite.db, SERVER_RENDER: 'true' } as Partial<Env>,
  });
  const request = async (path: string, init?: RequestInit) =>
    app.request(path, init, fake.env, fake.ctx);
  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function createLocked(query = '') {
    const { envelope, lock } = await lockContent(SECRET, PASSPHRASE);
    const res = await request(`/documents${query}`, json({ content: envelope, lock }));
    expect(res.status).toBe(201);
    const saved: SaveResponse = await res.json();
    return { ...saved, envelope, lock };
  }

  const unlock = (key: string, token: string) =>
    request(`/documents/${key}/unlock`, json({ token }));
  const failures = (key: string) =>
    sqlite.query('SELECT lock_failures AS n FROM documents WHERE id = ?', key)?.n;

  return { ...fake, sqlite, request, json, createLocked, unlock, failures };
}

/** A well-formed token that is not the right one. */
function wrongToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

describe('lock helpers', () => {
  it('accepts only well-formed lock specs', () => {
    const salt = toBase64Url(new Uint8Array(16));
    const token = toBase64Url(new Uint8Array(32));
    expect(isLockSpec({ salt, token })).toBe(true);
    expect(isLockSpec({ salt, token: token + 'A' })).toBe(false);
    expect(isLockSpec({ salt: salt.slice(1), token })).toBe(false);
    expect(isLockSpec({ salt, token: 'x'.repeat(42) + '=' })).toBe(false);
    expect(isLockSpec(null)).toBe(false);
  });

  it('compares verifiers exactly', async () => {
    const a = await verifierOf(toBase64Url(new Uint8Array(32)));
    const b = await verifierOf(wrongToken());
    expect(sameVerifier(a, a)).toBe(true);
    expect(sameVerifier(a, b)).toBe(false);
    expect(sameVerifier(a, a.slice(1))).toBe(false);
  });
});

describe('protected pastes', () => {
  it('store ciphertext and only a hash of the token', async () => {
    const { createLocked, sqlite } = setup();
    const { key, locked, envelope, lock } = await createLocked();
    expect(locked).toBe(true);

    const row = sqlite.query('SELECT * FROM documents WHERE id = ?', key)!;
    expect(row.content).toBe(envelope);
    expect(row.content).not.toContain('main');
    expect(row.lock_salt).toBe(lock.salt);
    expect(row.lock_verifier).toBe(await verifierOf(lock.token));
    expect(JSON.stringify(row)).not.toContain(lock.token);
  });

  it('are answered with a locked marker, never content, by GET and raw', async () => {
    const { createLocked, request } = setup();
    const { key, lock } = await createLocked();

    const res = await request(`/documents/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      key,
      locked: true,
      salt: lock.salt,
    } satisfies LockedPending);

    const raw = await request(`/raw/${key}`);
    expect(raw.status).toBe(403);
    expect(await raw.text()).toMatch(/Protected paste/);
  });

  it('render a page that embeds only the marker', async () => {
    const { createLocked, request } = setup();
    const { key, envelope, lock } = await createLocked();
    const res = await request(`/${key}`, { headers: { Accept: 'text/html' } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain(`id="${EMBEDDED_DOCUMENT_ID}"`);
    expect(html).toContain(lock.salt);
    expect(html).not.toContain(envelope);
  });

  it('open with the right passphrase, and the attempt is not counted', async () => {
    const { createLocked, unlock, failures } = setup();
    const { key, lock } = await createLocked();
    const opened = await openLock('Maple Orbit  quiet.LANTERN', lock.salt);

    const res = await unlock(key, opened.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const doc: GetResponse = await res.json();
    expect(await opened.decrypt(doc.content)).toBe(SECRET);
    expect(failures(key)).toBe(0);
  });

  it('count wrong passphrases and delete the paste on the last one', async () => {
    const { createLocked, unlock, failures, sqlite } = setup();
    const { key } = await createLocked();

    for (let i = 1; i < UNLOCK_ATTEMPTS; i++) {
      const res = await unlock(key, wrongToken());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        message: 'Wrong passphrase',
        attemptsLeft: UNLOCK_ATTEMPTS - i,
      } satisfies UnlockRejected);
      expect(failures(key)).toBe(i);
    }

    const last = await unlock(key, wrongToken());
    expect(last.status).toBe(410);
    expect(((await last.json()) as UnlockRejected).attemptsLeft).toBe(0);
    expect(sqlite.query('SELECT id FROM documents WHERE id = ?', key)).toBeUndefined();
    expect((await unlock(key, wrongToken())).status).toBe(404);
  });

  it('never allow more wrong guesses than the cap, even concurrently', async () => {
    const { createLocked, unlock } = setup();
    const { key } = await createLocked();
    const statuses = await Promise.all(
      Array.from({ length: UNLOCK_ATTEMPTS * 3 }, () =>
        unlock(key, wrongToken()).then((r) => r.status)
      )
    );
    const answered = statuses.filter((s) => s === 403 || s === 410);
    expect(answered).toHaveLength(UNLOCK_ATTEMPTS);
    expect(statuses.filter((s) => s === 410)).toHaveLength(1);
  });

  it('with burn after reading open once, by unlock only', async () => {
    const { createLocked, request, unlock, sqlite } = setup();
    const { key, lock, burn } = await createLocked('?burn=1');
    expect(burn).toBe(true);

    // A plain read (without ?peek) must not consume a protected burn paste.
    const marker: LockedPending = await (await request(`/documents/${key}`)).json();
    expect(marker).toEqual({ key, locked: true, salt: lock.salt, burn: true });

    const opened = await openLock(PASSPHRASE, lock.salt);
    const res = await unlock(key, opened.token);
    expect(res.status).toBe(200);
    const doc: GetResponse = await res.json();
    expect(doc.burn).toBe(true);
    expect(await opened.decrypt(doc.content)).toBe(SECRET);
    expect(sqlite.query('SELECT id FROM documents WHERE id = ?', key)).toBeUndefined();
    expect((await unlock(key, opened.token)).status).toBe(404);
  });

  it('reject malformed create and unlock requests', async () => {
    const { request, json, createLocked, unlock } = setup();
    const bad = await request(
      '/documents',
      json({ content: 'x', lock: { salt: 'a', token: 'b' } })
    );
    expect(bad.status).toBe(400);

    const { key } = await createLocked();
    expect((await unlock(key, 'short')).status).toBe(400);
    const plain = await request(`/documents/${key}/unlock`, { method: 'POST', body: 'x' });
    expect(plain.status).toBe(415);
    expect((await request(`/documents/${key}/unlock`)).status).toBe(405);
    expect((await unlock('no.such', wrongToken())).status).toBe(404);
  });

  it('leave plain pastes alone: no unlock for them', async () => {
    const { request, unlock } = setup();
    const res = await request('/documents', { method: 'POST', body: 'hello' });
    const { key }: SaveResponse = await res.json();
    expect((await unlock(key, wrongToken())).status).toBe(404);
    expect(((await (await request(`/documents/${key}`)).json()) as GetResponse).content).toBe(
      'hello'
    );
  });
});
