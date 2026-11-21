/**
 * Document API routes: create, fetch (JSON), fetch (raw).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { BURN_PENDING, type CreateOptions, type Env } from './types';
import { LIFETIMES, isLifetimeId, type BurnPending, type SaveResponse } from '../shared/types';
import { createStore } from './storage';
import { getServerConfig } from './config';
import {
  countView,
  isoOrNull,
  loadDocument,
  toGetResponse,
  type LoadedDocument,
} from './documents';
import { etagMatches, isJsonContentType } from './http';

type AppContext = Context<{ Bindings: Env }>;

export const api = new Hono<{ Bindings: Env }>();

/**
 * Pastes never change, so the ETag is stable and the browser may keep a copy,
 * but never past the paste's expiry. No `immutable`: a removed paste must be
 * able to disappear on the next revalidation.
 */
function applyDocumentCacheHeaders(c: AppContext, doc: LoadedDocument): void {
  c.header('ETag', doc.etag);

  const isLocalDev = !c.req.raw.cf;
  let maxAge = isLocalDev ? 0 : getServerConfig(c.env).browserCacheMaxAge;
  if (doc.expiresAt !== null) {
    maxAge = Math.min(maxAge, Math.max(0, doc.expiresAt - Math.floor(Date.now() / 1000)));
  }
  c.header('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-cache');
}

/**
 * Shared GET flow: load, 404, cache headers, 304, else `send`.
 *
 * Burn-after-reading pastes: a GET without ?peek reads and deletes them, and
 * the response is never cached. HEAD and ?peek=1 leave them in place and get
 * `pending` instead (no content).
 */
async function serveDocument(
  c: AppContext,
  send: (doc: LoadedDocument) => Response,
  pending: (key: string) => Response,
  notFound: () => Response,
  failed: () => Response
): Promise<Response> {
  try {
    const key = c.req.param('id') ?? '';
    const consume = c.req.method === 'GET' && c.req.query('peek') === undefined;
    const doc = await loadDocument(c, key, { consume });
    if (!doc) return notFound();
    if (doc === BURN_PENDING || doc.burn) {
      c.header('Cache-Control', 'no-store');
      return doc === BURN_PENDING ? pending(key) : send(doc);
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
    () => c.text('Document not found', 404),
    () => c.text('Error retrieving document', 500)
  )
);

const EXPIRES_HELP = `expires must be one of ${Object.keys(LIFETIMES).join(', ')}`;

/**
 * Creation options come from the query string, so they work with both plain
 * and JSON bodies, and a bare POST keeps the old defaults:
 * ?expires=3d|1w|1mo|6mo|never and ?burn=1.
 */
export function parseCreateOptions(query: URLSearchParams): CreateOptions | { error: string } {
  const options: CreateOptions = {};

  const expires = query.get('expires');
  if (expires !== null) {
    if (!isLifetimeId(expires)) return { error: EXPIRES_HELP };
    options.expireDays = LIFETIMES[expires];
  }

  const burn = query.get('burn');
  if (burn !== null) {
    const value = burn.trim().toLowerCase();
    if (value === '1' || value === 'true') options.burn = true;
    else if (value !== '0' && value !== 'false') return { error: 'burn must be 1 or 0' };
  }

  return options;
}

// Create new document
api.post('/documents', async (c) => {
  const store = createStore(c.env);
  const config = getServerConfig(c.env);

  const options = parseCreateOptions(new URL(c.req.url).searchParams);
  if ('error' in options) return c.json({ message: options.error }, 400);

  try {
    // Checked before reading the body: a full database refuses every paste.
    if (config.maxStorageBytes > 0 && (await store.sizeBytes()) >= config.maxStorageBytes) {
      return c.json({ message: 'Storage is full; try again later' }, 507);
    }

    let content: string;

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

    const { key, expiresAt } = await store.create(
      content,
      { strategy: config.keyStrategy, length: config.keyLength },
      options
    );

    const response: SaveResponse = {
      key,
      expiresAt: isoOrNull(expiresAt),
      ...(options.burn ? { burn: true } : {}),
    };
    return c.json(response, 201);
  } catch (error) {
    console.error('Error saving document:', error);
    return c.json({ message: 'Error saving document' }, 500);
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

api.all('/documents', methodNotAllowed('POST'));
api.all('/documents/:id', methodNotAllowed('GET, HEAD'));
api.all('/raw/:id', methodNotAllowed('GET, HEAD'));
