/**
 * Shared API contract between the worker and the client.
 * Worker-only types (bindings, storage) live in src/worker/types.ts.
 *
 * The language is not part of the contract: it lives in the URL extension
 * (/key.cpp), which the client resolves and highlights.
 */

/**
 * Paste lifetime presets accepted by POST /documents?expires=<id>, in days
 * (0 = never expires). The server may clamp them (MAX_EXPIRE_DAYS).
 */
export const LIFETIMES = { '3d': 3, '1w': 7, '1mo': 30, '6mo': 180, never: 0 } as const;
export type LifetimeId = keyof typeof LIFETIMES;

export const LIFETIME_LABELS: Record<LifetimeId, string> = {
  '3d': '3 days',
  '1w': '1 week',
  '1mo': '1 month',
  '6mo': '6 months',
  never: 'Permanent',
};

export function isLifetimeId(value: unknown): value is LifetimeId {
  return typeof value === 'string' && Object.hasOwn(LIFETIMES, value);
}

export interface SaveResponse {
  key: string;
  /** ISO 8601; null when the paste never expires. */
  expiresAt?: string | null;
  /** Burn after reading: the first full read deletes the paste. */
  burn?: true;
}

export interface GetResponse {
  content: string;
  key: string;
  /** Built-in read-only page (e.g. about): not recorded in recents, no duplicate/raw. */
  frozen?: boolean;
  /** ISO 8601 timestamps; null for built-in pages and documents that never expire. */
  createdAt?: string | null;
  expiresAt?: string | null;
  /** Burn-after-reading paste: this response was its only read, it is gone now. */
  burn?: true;
}

/**
 * Element id of the first document the worker embeds into the page it renders
 * (a <script type="application/json"> holding an EmbeddedPayload), so the
 * client can skip the initial /documents fetch.
 */
export const EMBEDDED_DOCUMENT_ID = 'embedded-document';

/** Embedded instead of a document when the worker confirmed the key does not exist. */
export interface EmbeddedNotFound {
  key: string;
  notFound: true;
}

/**
 * A burn-after-reading paste that has not been read yet: returned by
 * GET /documents/:id?peek=1 and embedded by the page render, without content.
 */
export interface BurnPending {
  key: string;
  burnPending: true;
}

export type EmbeddedPayload = GetResponse | EmbeddedNotFound | BurnPending;
