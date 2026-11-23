import type { Page } from '@playwright/test';

export interface MockStore {
  get(key: string): string | undefined;
  set(key: string, content: string): void;
  setFrozen(key: string, content: string): void;
  /** Store a burn-after-reading paste: the first non-peek GET deletes it. */
  setBurn(key: string, content: string): void;
  lastKey(): string | undefined;
  /** Query string of the last POST /documents (e.g. expires, burn). */
  lastSaveParams(): URLSearchParams | undefined;
  /** Whether the paste is protected (saved with a lock). */
  isLocked(key: string): boolean;
  /** Unlock attempts that failed so far. */
  lockFailures(key: string): number | undefined;
  failNextSave(): void;
  failNextLoad(): void;
  /** Sign-in mock (setupMockApi with { auth: true }). */
  auth: {
    signedIn: boolean;
    /** Keys saved while signed in. */
    owned: Set<string>;
    /** Keys saved with ?private=1. */
    privateKeys: Set<string>;
  };
}

export interface MockApiOptions {
  /** Sign-in is configured: /auth/* answer, saves while signed in are owned. */
  auth?: boolean;
  /** Display name the mock provider signs in as. */
  userName?: string;
}

/**
 * Creates an in-memory store and wires up page.route() interceptors
 * for POST /documents and GET /documents/:key.
 *
 * Call this before page.goto(). The returned store can be used in
 * assertions to verify what was saved.
 *
 * Key generation: sequential testkey0, testkey1, ... for predictability.
 */
export async function setupMockApi(page: Page, options: MockApiOptions = {}): Promise<MockStore> {
  // Make view transitions synchronous so the callback runs immediately rather
  // than being scheduled before the next frame. Without this, Playwright can
  // send fill()/click() commands before the transition callback fires, which
  // clears the editor and disables the save button.
  await page.addInitScript(() => {
    if ('startViewTransition' in document) {
      document.startViewTransition = (callback?: () => void | Promise<void>) => {
        if (callback) callback();
        const p = Promise.resolve() as Promise<undefined>;
        return {
          ready: p,
          finished: p,
          updateCallbackDone: p,
          skipTransition: () => {},
        } as ViewTransition;
      };
    }
  });

  const docs = new Map<string, string>();
  const frozenKeys = new Set<string>();
  const burnKeys = new Set<string>();
  // Protected pastes: the mock compares tokens directly (the worker compares hashes).
  const locks = new Map<string, { salt: string; token: string; failures: number }>();
  const UNLOCK_ATTEMPTS = 10;
  let counter = 0;
  let lastSavedKey: string | undefined;
  let lastParams: URLSearchParams | undefined;
  let saveShouldFail = false;
  let loadShouldFail = false;
  const auth = { signedIn: false, owned: new Set<string>(), privateKeys: new Set<string>() };
  const userName = options.userName ?? 'Ada Lovelace';

  const store: MockStore = {
    get: (key) => docs.get(key),
    set: (key, content) => docs.set(key, content),
    setFrozen: (key, content) => {
      docs.set(key, content);
      frozenKeys.add(key);
    },
    setBurn: (key, content) => {
      docs.set(key, content);
      burnKeys.add(key);
    },
    lastKey: () => lastSavedKey,
    lastSaveParams: () => lastParams,
    isLocked: (key) => locks.has(key),
    lockFailures: (key) => locks.get(key)?.failures,
    failNextSave: () => {
      saveShouldFail = true;
    },
    failNextLoad: () => {
      loadShouldFail = true;
    },
    auth,
  };
  /** What GET answers carry for ownership; a private paste is a 404 for others. */
  const ownership = (key: string) => ({
    ...(auth.signedIn && auth.owned.has(key) ? { mine: true } : {}),
    ...(auth.privateKeys.has(key) ? { private: true } : {}),
  });
  const hidden = (key: string) => auth.privateKeys.has(key) && !auth.signedIn;

  // POST /documents[?expires=..&burn=1] -- create new paste
  await page.route(/\/documents(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    if (saveShouldFail) {
      saveShouldFail = false;
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
      return;
    }
    const isJson = (route.request().headers()['content-type'] ?? '').includes('json');
    const body = isJson ? route.request().postDataJSON() : null;
    const content = body ? body.content : (route.request().postData() ?? '');
    const params = new URL(route.request().url()).searchParams;
    const isPrivate = params.get('private') === '1';
    if (isPrivate && !auth.signedIn) {
      await route.fulfill({ status: 401, body: '{"message":"Sign in"}' });
      return;
    }
    const key = `testkey${counter++}`;
    const burn = params.get('burn') === '1';
    docs.set(key, content);
    if (auth.signedIn) auth.owned.add(key);
    if (isPrivate) auth.privateKeys.add(key);
    if (burn) burnKeys.add(key);
    if (body?.lock) locks.set(key, { ...body.lock, failures: 0 });
    lastSavedKey = key;
    lastParams = params;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        key,
        expiresAt: null,
        ...(burn && { burn: true }),
        ...(body?.lock && { locked: true }),
        ...(isPrivate && { private: true }),
      }),
    });
  });

  // GET /documents/:id -- retrieve paste
  await page.route('**/documents/**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    if (loadShouldFail) {
      loadShouldFail = false;
      await route.fulfill({ status: 500, body: 'Server Error' });
      return;
    }
    const url = new URL(route.request().url());
    const key = url.pathname.split('/').pop() ?? '';
    const content = hidden(key) ? undefined : docs.get(key);
    const lock = locks.get(key);
    if (content !== undefined && lock) {
      const burn = burnKeys.has(key) ? { burn: true } : {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ key, locked: true, salt: lock.salt, ...burn, ...ownership(key) }),
      });
    } else if (content !== undefined && burnKeys.has(key)) {
      const peek = url.searchParams.has('peek');
      if (!peek) {
        docs.delete(key);
        burnKeys.delete(key);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(peek ? { key, burnPending: true } : { content, key, burn: true }),
      });
    } else if (content !== undefined) {
      const frozen = frozenKeys.has(key) ? true : undefined;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content, key, ...(frozen && { frozen }), ...ownership(key) }),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Document not found' }),
      });
    }
  });

  // POST /documents/:id/unlock -- registered last, so it is matched before the GET route.
  await page.route(/\/documents\/[^/]+\/unlock$/, async (route) => {
    const key = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    const lock = locks.get(key);
    const json = (status: number, data: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (!lock) return json(404, { message: 'Document not found' });
    if (route.request().postDataJSON().token !== lock.token) {
      lock.failures++;
      const attemptsLeft = UNLOCK_ATTEMPTS - lock.failures;
      if (attemptsLeft > 0) return json(403, { message: 'Wrong passphrase', attemptsLeft });
      docs.delete(key);
      locks.delete(key);
      return json(410, { message: 'Too many wrong passphrases', attemptsLeft: 0 });
    }
    const content = docs.get(key);
    const burn = burnKeys.has(key);
    if (burn) {
      docs.delete(key);
      locks.delete(key);
      burnKeys.delete(key);
    }
    return json(200, { key, content, ...(burn && { burn: true }) });
  });

  if (options.auth) await installAuthRoutes(page, store, docs, locks, burnKeys, userName);
  return store;
}

async function installAuthRoutes(
  page: Page,
  store: MockStore,
  docs: Map<string, string>,
  locks: Map<string, unknown>,
  burnKeys: Set<string>,
  userName: string
): Promise<void> {
  const { auth } = store;
  const json = (status: number, data: unknown) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });

  await page.route('**/auth/me', (route) =>
    route.fulfill(json(200, { enabled: true, user: auth.signedIn ? { name: userName } : null }))
  );
  // The provider round trip, collapsed: sign in and come straight back.
  await page.route('**/auth/login**', async (route) => {
    const url = new URL(route.request().url());
    auth.signedIn = true;
    await page.context().addCookies([{ name: 'pb_in', value: '1', url: url.origin }]);
    await route.fulfill({
      status: 302,
      headers: { Location: url.searchParams.get('return') ?? '/' },
    });
  });
  await page.route('**/auth/logout', async (route) => {
    auth.signedIn = false;
    await page.context().clearCookies({ name: 'pb_in' });
    await route.fulfill({ status: 204 });
  });

  // GET /documents: own pastes, newest first.
  await page.route(/\/documents(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (!auth.signedIn) return route.fulfill(json(401, { message: 'Sign in' }));
    const items = [...auth.owned]
      .filter((key) => docs.has(key))
      .reverse()
      .map((key) => {
        const content = docs.get(key)!;
        const locked = locks.has(key);
        const burn = burnKeys.has(key);
        return {
          key,
          createdAt: new Date().toISOString(),
          expiresAt: null,
          size: content.length,
          ...(burn && { burn: true }),
          ...(locked && { locked: true }),
          ...(auth.privateKeys.has(key) && { private: true }),
          ...(!burn && !locked && { preview: content.split('\n')[0] }),
        };
      });
    return route.fulfill(json(200, { items }));
  });

  // DELETE /documents/:id
  await page.route(/\/documents\/[^/?]+$/, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const key = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (!auth.signedIn) return route.fulfill(json(401, { message: 'Sign in' }));
    if (!auth.owned.has(key) || !docs.has(key)) {
      return route.fulfill(json(404, { message: 'Document not found' }));
    }
    docs.delete(key);
    auth.owned.delete(key);
    auth.privateKeys.delete(key);
    return route.fulfill({ status: 204 });
  });
}
