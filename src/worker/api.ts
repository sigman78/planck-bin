/**
 * Document API routes: create, fetch (JSON), fetch (raw), unlock, and for a
 * signed-in user: list own pastes, delete one.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  BURN_PENDING,
  type CreateOptions,
  type Env,
  type LockedStub,
  type OwnedCursor,
} from './types';
import {
  LIFETIMES,
  UNLOCK_ATTEMPTS,
  isLifetimeId,
  type BurnPending,
  type LockSpec,
  type OwnedList,
  type OwnedPaste,
  type SaveResponse,
  type UnlockRejected,
} from '../shared/types';
import { createStore } from './storage';
import { getAuthConfig, getServerConfig } from './config';
import { viewerId, viewerOf } from './session';
import {
  countView,
  fromStored,
  isLockedStub,
  isValidKey,
  isoOrNull,
  loadDocument,
  lockedPending,
  toGetResponse,
  type LoadedDocument,
} from './documents';
import { etagMatches, isJsonContentType } from './http';
import { isLockSpec, isUnlockToken, sameVerifier, verifierOf } from './locks';

type AppContext = Context<{ Bindings: Env }>;

export const api = new Hono<{ Bindings: Env }>();

/**
 * Pastes never change, so the ETag is stable and the browser may keep a copy,
 * but never past the paste's expiry. No `immutable`: a removed paste must be
 * able to disappear on the next revalidation.
 */
function applyDocumentCacheHeaders(c: AppContext, doc: LoadedDocument): void {
  c.header('ETag', doc.etag);
  // With sign-in on, the answer depends on who asks (`mine`).
  if (getAuthConfig(c.env)) c.header('Vary', 'Cookie');

  const isLocalDev = !c.req.raw.cf;
  let maxAge = isLocalDev ? 0 : getServerConfig(c.env).browserCacheMaxAge;
  if (doc.expiresAt !== null) {
    maxAge = Math.min(maxAge, Math.max(0, doc.expiresAt - Math.floor(Date.now() / 1000)));
  }
  const scope = doc.mine ? 'private' : 'public';
  c.header('Cache-Control', maxAge > 0 ? `${scope}, max-age=${maxAge}` : 'no-cache');
}

/**
 * Shared GET flow: load, 404, cache headers, 304, else `send`.
 *
 * Burn-after-reading pastes: a GET without ?peek reads and deletes them, and
 * the response is never cached. HEAD and ?peek=1 leave them in place and get
 * `pending` instead (no content).
 *
 * Protected pastes always get `locked` (no content, never cached): only
 * POST /documents/:id/unlock reads them.
 */
async function serveDocument(
  c: AppContext,
  send: (doc: LoadedDocument) => Response,
  pending: (key: string) => Response,
  locked: (key: string, stub: LockedStub) => Response,
  notFound: () => Response,
  failed: () => Response
): Promise<Response> {
  try {
    const key = c.req.param('id') ?? '';
    const consume = c.req.method === 'GET' && c.req.query('peek') === undefined;
    const doc = await loadDocument(c, key, { consume });
    if (!doc) return notFound();
    if (isLockedStub(doc)) {
      c.header('Cache-Control', 'no-store');
      return locked(key, doc);
    }
    if (doc === BURN_PENDING || doc.burn) {
      c.header('Cache-Control', 'no-store');
      return doc === BURN_PENDING ? pending(key) : send(doc);
    }
    // No copy of a private paste anywhere: it would outlive a sign-out.
    if (doc.private) {
      c.header('Cache-Control', 'private, no-store');
      return send(doc);
    }

    applyDocumentCacheHeaders(c, doc);
    if (etagMatches(c.req.header('if-none-match'), doc.etag)) return c.body(null, 304);
    countView(c, doc);
    return send(doc);
  } catch (error) {
    console.error('Error retrieving document:', error);
    return failed();
  }
}

// Get document by key (JSON)
api.get('/documents/:id', (c) =>
  serveDocument(
    c,
    (doc) => c.json(toGetResponse(doc)),
    (key) => c.json({ key, burnPending: true } satisfies BurnPending),
    (key, stub) => c.json(lockedPending(key, stub)),
    () => c.json({ message: 'Document not found' }, 404),
    () => c.json({ message: 'Error retrieving document' }, 500)
  )
);

// Raw document (for copy/download); built-in pages are served too
api.get('/raw/:id', (c) =>
  serveDocument(
    c,
    (doc) => c.text(doc.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
    () =>
      c.text('Burn after reading: request without ?peek to read (and destroy) it', 200, {
        'Content-Type': 'text/plain; charset=utf-8',
      }),
    // The server holds only ciphertext: there is nothing readable to send.
    () => c.text('Protected paste: open it in a browser and enter the passphrase', 403),
    () => c.text('Document not found', 404),
    () => c.text('Error retrieving document', 500)
  )
);

const EXPIRES_HELP = `expires must be one of ${Object.keys(LIFETIMES).join(', ')}`;

function flag(value: string | null, name: string): boolean | undefined | { error: string } {
  if (value === null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return { error: `${name} must be 1 or 0` };
}

/**
 * Creation options come from the query string, so they work with both plain
 * and JSON bodies, and a bare POST keeps the old defaults:
 * ?expires=3d|1w|1mo|6mo|never, ?burn=1 and ?private=1 (signed in only).
 */
export function parseCreateOptions(query: URLSearchParams): CreateOptions | { error: string } {
  const options: CreateOptions = {};

  const expires = query.get('expires');
  if (expires !== null) {
    if (!isLifetimeId(expires)) return { error: EXPIRES_HELP };
    options.expireDays = LIFETIMES[expires];
  }

  const burn = flag(query.get('burn'), 'burn');
  if (typeof burn === 'object') return burn;
  if (burn) options.burn = true;

  const isPrivate = flag(query.get('private'), 'private');
  if (typeof isPrivate === 'object') return isPrivate;
  if (isPrivate) options.private = true;

  // A note to self that destroys itself on the first read has no reader.
  if (options.burn && options.private) {
    return { error: 'a paste cannot be both private and burn after reading' };
  }
  return options;
}

// Create new document
api.post('/documents', async (c) => {
  const store = createStore(c.env);
  const config = getServerConfig(c.env);

  const options = parseCreateOptions(new URL(c.req.url).searchParams);
  if ('error' in options) return c.json({ message: options.error }, 400);

  // Signed in: the paste is owned (listed in My pastes, deletable).
  const viewer = await viewerId(c);
  if (options.private && viewer === null) {
    return c.json({ message: 'Sign in to save private pastes' }, 401);
  }
  if (viewer !== null) options.owner = viewer;

  try {
    // Checked before reading the body: a full database refuses every paste.
    if (config.maxStorageBytes > 0 && (await store.sizeBytes()) >= config.maxStorageBytes) {
      return c.json({ message: 'Storage is full; try again later' }, 507);
    }

    let content: string;
    let lock: LockSpec | undefined;

    if (isJsonContentType(c.req.header('content-type'))) {
      let body: unknown;
      try {
        body = await c.req.json<unknown>();
      } catch {
        return c.json({ message: 'Invalid JSON body' }, 400);
      }

      if (
        !body ||
        typeof body !== 'object' ||
        typeof (body as { content?: unknown }).content !== 'string'
      ) {
        return c.json({ message: 'JSON body must contain a string content field' }, 400);
      }
      content = (body as { content: string }).content;

      const lockField = (body as { lock?: unknown }).lock;
      if (lockField !== undefined) {
        if (!isLockSpec(lockField)) {
          return c.json({ message: 'lock must hold a base64url salt and token' }, 400);
        }
        lock = lockField;
      }
    } else {
      content = await c.req.text();
    }

    // Validate content
    if (!content || content.trim().length === 0) {
      return c.json({ message: 'No content provided' }, 400);
    }

    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > config.maxPasteSize) {
      return c.json(
        { message: `Document exceeds maximum size of ${config.maxPasteSize} bytes` },
        413
      );
    }

    if (lock) {
      options.lock = { salt: lock.salt, verifier: await verifierOf(lock.token) };
    }

    const { key, expiresAt } = await store.create(
      content,
      { strategy: config.keyStrategy, length: config.keyLength },
      options
    );

    const response: SaveResponse = {
      key,
      expiresAt: isoOrNull(expiresAt),
      ...(options.burn ? { burn: true } : {}),
      ...(lock ? { locked: true } : {}),
      ...(options.private ? { private: true } : {}),
    };
    return c.json(response, 201);
  } catch (error) {
    console.error('Error saving document:', error);
    return c.json({ message: 'Error saving document' }, 500);
  }
});

/**
 * Unlock a protected paste: { token } in, the stored (encrypted) document out.
 * Every attempt is counted before it is checked; a right one is uncounted
 * again, and the wrong one that reaches UNLOCK_ATTEMPTS deletes the paste.
 */
api.post('/documents/:id/unlock', async (c) => {
  const key = c.req.param('id');
  if (!isJsonContentType(c.req.header('content-type'))) {
    return c.json({ message: 'Expected a JSON body' }, 415);
  }
  let token: unknown;
  try {
    token = (await c.req.json<{ token?: unknown } | null>())?.token;
  } catch {
    return c.json({ message: 'Invalid JSON body' }, 400);
  }
  if (!isUnlockToken(token)) return c.json({ message: 'token must be base64url' }, 400);

  c.header('Cache-Control', 'no-store');
  const notFound = () => c.json({ message: 'Document not found' }, 404);
  if (!isValidKey(key)) return notFound();

  try {
    const store = createStore(c.env);
    const viewer = await viewerId(c);
    const candidate = await store.reserveUnlock(key, UNLOCK_ATTEMPTS, viewer);
    if (!candidate) return notFound();

    if (!sameVerifier(await verifierOf(token), candidate.verifier)) {
      const attemptsLeft = Math.max(0, UNLOCK_ATTEMPTS - candidate.failures);
      if (attemptsLeft > 0) {
        return c.json({ message: 'Wrong passphrase', attemptsLeft } satisfies UnlockRejected, 403);
      }
      await store.remove(key);
      const gone: UnlockRejected = {
        message: 'Too many wrong passphrases: the paste is deleted',
        attemptsLeft,
      };
      return c.json(gone, 410);
    }

    if (candidate.burn) {
      // One statement picks the only reader, as with plain burn pastes.
      const taken = await store.takeLocked(key, viewer);
      return taken ? c.json(toGetResponse(fromStored(key, taken, true, viewer))) : notFound();
    }
    // Awaited: a lost release would leave the right passphrase spending attempts.
    await store.releaseUnlock(key);
    return c.json(toGetResponse(fromStored(key, candidate, false, viewer)));
  } catch (error) {
    console.error('Error unlocking document:', error);
    return c.json({ message: 'Error unlocking document' }, 500);
  }
});

/** Rows per page of GET /documents. */
export const OWNED_PAGE_SIZE = 50;
/** Characters of the first non-blank line shown in the owner's list. */
const PREVIEW_CHARS = 80;

/** "createdAt.key" (createdAt in unix seconds); null when absent or malformed. */
export function parseOwnedCursor(value: string | undefined): OwnedCursor | null | 'invalid' {
  if (value === undefined) return null;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{1,64})$/.exec(value);
  return m ? { createdAt: Number(m[1]), key: m[2] } : 'invalid';
}

export function previewLine(head: string | null): string | undefined {
  if (head === null) return undefined;
  const line = head.split('\n').find((l) => l.trim() !== '');
  if (line === undefined) return undefined;
  const text = line.trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 3)}...` : text;
}

// The signed-in user's own pastes, newest first: ?before=<cursor> pages on.
api.get('/documents', async (c) => {
  c.header('Cache-Control', 'no-store');
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ message: 'Sign in to list your pastes' }, 401);

  const before = parseOwnedCursor(c.req.query('before'));
  if (before === 'invalid') return c.json({ message: 'Invalid cursor' }, 400);

  try {
    // One extra row says whether there is a next page.
    const rows = await createStore(c.env).listOwned(viewer.uid, before, OWNED_PAGE_SIZE + 1);
    const page = rows.slice(0, OWNED_PAGE_SIZE);
    const items: OwnedPaste[] = page.map((row) => {
      const preview = previewLine(row.head);
      return {
        key: row.key,
        createdAt: isoOrNull(row.createdAt)!,
        expiresAt: isoOrNull(row.expiresAt),
        size: row.size,
        ...(row.burn ? { burn: true } : {}),
        ...(row.locked ? { locked: true } : {}),
        ...(row.private ? { private: true } : {}),
        ...(preview !== undefined ? { preview } : {}),
      };
    });
    const last = page[page.length - 1];
    const list: OwnedList = {
      items,
      ...(rows.length > OWNED_PAGE_SIZE && last ? { next: `${last.createdAt}.${last.key}` } : {}),
    };
    return c.json(list);
  } catch (error) {
    console.error('Error listing documents:', error);
    return c.json({ message: 'Error listing documents' }, 500);
  }
});

// Delete one of the signed-in user's pastes. Missing and not-yours look the same.
api.delete('/documents/:id', async (c) => {
  c.header('Cache-Control', 'no-store');
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ message: 'Sign in to delete pastes' }, 401);
  const key = c.req.param('id');
  if (!isValidKey(key)) return c.json({ message: 'Document not found' }, 404);
  try {
    const removed = await createStore(c.env).removeOwned(key, viewer.uid);
    return removed ? c.body(null, 204) : c.json({ message: 'Document not found' }, 404);
  } catch (error) {
    console.error('Error deleting document:', error);
    return c.json({ message: 'Error deleting document' }, 500);
  }
});

// Anything else on the document routes: 405 with the methods that do exist.
// Registered last, so the handlers above win for their methods (GET also serves HEAD).
function methodNotAllowed(allow: string) {
  return (c: AppContext) => {
    c.header('Allow', allow);
    return c.json({ message: 'Method not allowed' }, 405);
  };
}

api.all('/documents', methodNotAllowed('GET, HEAD, POST'));
api.all('/documents/:id', methodNotAllowed('GET, HEAD, DELETE'));
api.all('/documents/:id/unlock', methodNotAllowed('POST'));
api.all('/raw/:id', methodNotAllowed('GET, HEAD'));
