/**
 * One loader for everything that reads a document: GET /documents/:id,
 * GET /raw/:id and the server-rendered paste page.
 *
 * Built-in pages (e.g. "about") are static markdown assets presented as
 * frozen, read-only pastes; everything else comes from D1.
 */

import type { Context } from 'hono';
import type { GetResponse } from '../shared/types';
import type { Env } from './types';
import { createStore } from './storage';

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
 */
export async function loadDocument(c: AppContext, key: string): Promise<LoadedDocument | null> {
  if (isBuiltinPage(key)) return loadBuiltinPage(c, key);
  if (!isValidKey(key)) return null;

  const stored = await createStore(c.env).get(key);
  if (!stored) return null;

  countViewInBackground(c, key);
  return {
    key,
    content: stored.content,
    frozen: false,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    etag: `"${key}-${stored.createdAt}"`,
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
    etag: `"${key}-${fnv1a(content)}"`,
  };
}

function countViewInBackground(c: AppContext, key: string): void {
  const store = createStore(c.env);
  c.executionCtx.waitUntil(
    store.incrementViews(key).catch((err) => console.error('View count update failed:', err))
  );
}

function isoOrNull(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

export function toGetResponse(doc: LoadedDocument): GetResponse {
  return {
    key: doc.key,
    content: doc.content,
    ...(doc.frozen ? { frozen: true } : {}),
    createdAt: isoOrNull(doc.createdAt),
    expiresAt: isoOrNull(doc.expiresAt),
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
