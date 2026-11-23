/** @jest-environment node */

import { fakeEnv } from '../__fakes__/env';
import { sqliteD1 } from '../__fakes__/sqlite-d1';
import { AUTH_VARS, claimsFor, installFakeIdp, signJwt, type FakeIdp } from '../__fakes__/idp';
import { ORIGIN, requester, signIn, testApp, type Requester } from '../__fakes__/sign-in';
import { VIEWER_ANCHOR } from '../render';
import type { Env } from '../types';
import { lockContent } from '../../client/lock-crypto';
import type { GetResponse, LockedPending, OwnedList, SaveResponse } from '../../shared/types';

const SHELL =
  '<html><head><title>Planck Bin</title></head><body>' + VIEWER_ANCHOR + '</body></html>';

const app = testApp();
let idp: FakeIdp & { nonce: string };

beforeEach(async () => {
  idp = await installFakeIdp();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  idp.restore();
  jest.restoreAllMocks();
});

/** One database, three browsers: the owner, another signed-in user, and anonymous. */
async function setup() {
  const sqlite = sqliteD1();
  const fake = fakeEnv({
    assets: { '/index.html': SHELL },
    vars: { DB: sqlite.db, SERVER_RENDER: 'true', ...AUTH_VARS } as Partial<Env>,
  });
  const owner = requester(app, fake.env, fake.ctx);
  const other = requester(app, fake.env, fake.ctx);
  const anon = requester(app, fake.env, fake.ctx);
  await signIn(owner, idp);
  idp.tokenFor = (n) => signJwt(idp.keys[0], claimsFor(n, { sub: 'user-2', name: 'Bob' }));
  await signIn(other, idp);
  return { sqlite, owner, other, anon };
}

const post = (body: string): RequestInit => ({
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
  body,
});

async function save(request: Requester, body: string, query = '') {
  const res = await request(`/documents${query}`, post(body));
  return { status: res.status, saved: (await res.json()) as SaveResponse & { message?: string } };
}

const del = (request: Requester, key: string, origin = ORIGIN) =>
  request(`/documents/${key}`, { method: 'DELETE', headers: { Origin: origin } });

describe('ownership', () => {
  it('owns pastes saved while signed in, and says so to the owner only', async () => {
    const { owner, other, anon, sqlite } = await setup();
    const { saved } = await save(owner, 'mine');
    expect(sqlite.query('SELECT owner FROM documents WHERE id = ?', saved.key)?.owner).toMatch(
      /^[A-Za-z0-9_-]{22}$/
    );

    const own = await owner(`/documents/${saved.key}`);
    expect(((await own.json()) as GetResponse).mine).toBe(true);
    expect(own.headers.get('vary')).toBe('Cookie');
    expect(own.headers.get('etag')).toMatch(/-m"$/);
    for (const request of [other, anon]) {
      const res = await request(`/documents/${saved.key}`);
      expect(((await res.json()) as GetResponse).mine).toBeUndefined();
      expect(res.headers.get('etag')).not.toMatch(/-m"$/);
    }
  });

  it('keeps anonymous pastes unowned', async () => {
    const { anon, sqlite } = await setup();
    const { saved } = await save(anon, 'anon');
    expect(sqlite.query('SELECT owner FROM documents WHERE id = ?', saved.key)?.owner).toBeNull();
  });
});

describe('private pastes', () => {
  it('needs a session, and cannot also burn', async () => {
    const { anon, owner } = await setup();
    expect((await save(anon, 'x', '?private=1')).status).toBe(401);
    expect((await save(owner, 'x', '?private=1&burn=1')).status).toBe(400);
    expect((await save(owner, 'x', '?private=yes')).status).toBe(400);
  });

  it('is readable by its owner only, on every read path', async () => {
    const { owner, other, anon } = await setup();
    const { status, saved } = await save(owner, 'secret plan', '?private=1');
    expect(status).toBe(201);
    expect(saved.private).toBe(true);

    const res = await owner(`/documents/${saved.key}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: 'secret plan', mine: true, private: true });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('etag')).toBeNull();
    expect((await owner(`/raw/${saved.key}`)).status).toBe(200);
    const page = await owner(`/${saved.key}`, { headers: { Accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(await page.text()).toContain('secret plan');

    // Everyone else: exactly what a missing paste looks like.
    for (const request of [other, anon]) {
      for (const path of [`/documents/${saved.key}`, `/raw/${saved.key}`]) {
        expect((await request(path)).status).toBe(404);
        expect((await request(path, { method: 'HEAD' })).status).toBe(404);
      }
      const html = await request(`/${saved.key}`, { headers: { Accept: 'text/html' } });
      expect(html.status).toBe(404);
      expect(await html.text()).not.toContain('secret plan');
    }
  });

  it('composes with a passphrase: a stranger cannot even try one', async () => {
    const { owner, other } = await setup();
    const { envelope, lock } = await lockContent('locked note', 'maple-orbit-quiet-lantern');
    const res = await owner('/documents?private=1', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: envelope, lock }),
    });
    const { key } = (await res.json()) as SaveResponse;

    const stub = (await (await owner(`/documents/${key}`)).json()) as LockedPending;
    expect(stub).toMatchObject({ locked: true, mine: true });
    expect((await other(`/documents/${key}`)).status).toBe(404);
    const unlock = await other(`/documents/${key}/unlock`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: lock.token }),
    });
    expect(unlock.status).toBe(404);
  });
});

describe('GET /documents (own pastes)', () => {
  it('needs a session', async () => {
    const { anon } = await setup();
    const res = await anon('/documents');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it("lists only the caller's live pastes, newest first, with safe previews", async () => {
    const { owner, other, sqlite } = await setup();
    const plain = (await save(owner, '\n\n  first line of it  \nsecond')).saved.key;
    const burn = (await save(owner, 'burn me', '?burn=1')).saved.key;
    const priv = (await save(owner, 'x'.repeat(200), '?private=1')).saved.key;
    await save(other, 'not yours');
    const gone = (await save(owner, 'old')).saved.key;
    sqlite.query('UPDATE documents SET expires_at = 1 WHERE id = ? RETURNING id', gone);
    // Distinct, ordered creation times.
    [plain, burn, priv].forEach((key, i) =>
      sqlite.query('UPDATE documents SET created_at = ? WHERE id = ? RETURNING id', 1000 + i, key)
    );

    const list = (await (await owner('/documents')).json()) as OwnedList;
    expect(list.next).toBeUndefined();
    expect(list.items.map((i) => i.key)).toEqual([priv, burn, plain]);
    const [p, b, f] = list.items;
    expect(p).toMatchObject({ private: true, size: 200 });
    expect(p.preview).toBe(`${'x'.repeat(77)}...`);
    expect(b).toMatchObject({ burn: true });
    expect(b.preview).toBeUndefined();
    expect(f.preview).toBe('first line of it');
    expect(f.createdAt).toBe(new Date(1_000_000).toISOString());
  });

  it('pages with a cursor', async () => {
    const { owner, sqlite } = await setup();
    const keys: string[] = [];
    for (let i = 0; i < 52; i++) keys.push((await save(owner, `paste ${i}`)).saved.key);
    keys.forEach((key, i) =>
      sqlite.query('UPDATE documents SET created_at = ? WHERE id = ? RETURNING id', 5000 + i, key)
    );
    const first = (await (await owner('/documents')).json()) as OwnedList;
    expect(first.items).toHaveLength(50);
    expect(first.next).toBe(`${5002}.${keys[2]}`);
    const second = (await (await owner(`/documents?before=${first.next}`)).json()) as OwnedList;
    expect(second.items.map((i) => i.key)).toEqual([keys[1], keys[0]]);
    expect(second.next).toBeUndefined();
    expect((await owner('/documents?before=nonsense')).status).toBe(400);
  });
});

describe('DELETE /documents/:id', () => {
  it("deletes the owner's paste; anyone else gets 401 or 404 and nothing changes", async () => {
    const { owner, other, anon } = await setup();
    const { key } = (await save(owner, 'delete me')).saved;

    expect((await del(anon, key)).status).toBe(401);
    expect((await del(other, key)).status).toBe(404);
    expect((await del(owner, key, 'https://evil.test')).status).toBe(403);
    expect((await owner(`/documents/${key}`)).status).toBe(200);

    expect((await del(owner, key)).status).toBe(204);
    expect((await owner(`/documents/${key}`)).status).toBe(404);
    expect((await del(owner, key)).status).toBe(404);
  });
});
