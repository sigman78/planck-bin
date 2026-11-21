/**
 * One loader for everything that reads a document: GET /documents/:id,
 * GET /raw/:id and the server-rendered paste page.
 *
 * Built-in pages (e.g. "about") are static markdown assets presented as
 * frozen, read-only pastes; everything else comes from D1.
 */

import type { Context } from 'hono';
import type { GetResponse } from '../shared/types';
import { BURN_PENDING, type BurnPending, type Env, type StoredDocument } from './types';
import { createStore } from './storage';
import { getServerConfig } from './config';

type AppContext = Context<{ Bindings: Env }>;

/** Built-in pages: key -> static asset path. Resolved before key validation. */
const BUILTIN_PAGES: Record<string, string> = {
  about: '/_about.md',
};

/** Keys of every strategy (pronounceable, random, uuid) fit this. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface LoadedDocument {
  key: string;
  content: string;
  frozen: boolean;
  /** Unix seconds; null for built-in pages. */
  createdAt: number | null;
  expiresAt: number | null;
  /** Burn after reading: this load deleted it, so it must not be cached or counted. */
  burn: boolean;
  /** Strong validator: stored pastes never change; built-in pages change per deploy. */
  etag: string;
}

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function isBuiltinPage(key: string): boolean {
  return Object.hasOwn(BUILTIN_PAGES, key);
}

/**
 * Load a document by key, or null when it does not exist (including invalid
 * keys, which never reach D1). Storage errors propagate to the caller.
 *
 * A burn-after-reading document yields BURN_PENDING unless `consume` is set;
 * then it is deleted and returned (or null when another read got it first).
 */
export async function loadDocument(
  c: AppContext,
  key: string,
  { consume = false }: { consume?: boolean } = {}
): Promise<LoadedDocument | BurnPending | null> {
  if (isBuiltinPage(key)) return loadBuiltinPage(c, key);
  if (!isValidKey(key)) return null;

  const store = createStore(c.env);
  const stored = await store.get(key);
  if (stored !== BURN_PENDING) return stored ? fromStored(key, stored, false) : null;
  if (!consume) return BURN_PENDING;

  const taken = await store.take(key);
  return taken ? fromStored(key, taken, true) : null;
}

/**
 * Like loadDocument, for the server-rendered page: content longer than
 * `maxChars` stays in D1 (the page falls back to the client fetch), so an
 * oversized paste is not read just to be discarded. SQLite counts code points
 * where JS counts UTF-16 units, so callers keep their own length check.
 */
export async function loadDocumentWithin(
  c: AppContext,
  key: string,
  maxChars: number
): Promise<LoadedDocument | BurnPending | 'too-large' | null> {
  if (isBuiltinPage(key)) {
    const page = await loadBuiltinPage(c, key);
    return page && page.content.length > maxChars ? 'too-large' : page;
  }
  if (!isValidKey(key)) return null;

  const stored = await createStore(c.env).getWithin(key, maxChars);
  if (stored === null || stored === 'too-large' || stored === BURN_PENDING) return stored;
  return fromStored(key, stored, false);
}

function fromStored(key: string, stored: StoredDocument, burn: boolean): LoadedDocument {
  return {
    key,
    content: stored.content,
    frozen: false,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    burn,
    etag: burn ? '' : `"${key}-${stored.createdAt}"`,
  };
}

async function loadBuiltinPage(c: AppContext, key: string): Promise<LoadedDocument | null> {
  const url = new URL(c.req.url);
  url.pathname = BUILTIN_PAGES[key];
  url.search = '';
  const response = await c.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!response.ok) return null;

  const content = await response.text();
  return {
    key,
    content,
    frozen: true,
    createdAt: null,
    expiresAt: null,
    burn: false,
    etag: `"${key}-${fnv1a(content)}"`,
  };
}

/**
 * Count a view of a document that is being sent in full: call it only after
 * the 304 check, so revalidations, HEAD requests and abandoned server renders
 * never count. Off unless COUNT_VIEWS is set, because each count is a D1 write
 * and the free plan allows far fewer writes than reads.
 */
export function countView(c: AppContext, doc: LoadedDocument): void {
  if (doc.frozen || doc.burn || c.req.method !== 'GET' || !getServerConfig(c.env).countViews)
    return;
  const store = createStore(c.env);
  c.executionCtx.waitUntil(
    store.incrementViews(doc.key).catch((err) => console.error('View count update failed:', err))
  );
}

export function isoOrNull(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

export function toGetResponse(doc: LoadedDocument): GetResponse {
  return {
    key: doc.key,
    content: doc.content,
    ...(doc.frozen ? { frozen: true } : {}),
    createdAt: isoOrNull(doc.createdAt),
    expiresAt: isoOrNull(doc.expiresAt),
    ...(doc.burn ? { burn: true } : {}),
  };
}

/** 32-bit FNV-1a over UTF-16 code units, as hex. Cheap content fingerprint. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
