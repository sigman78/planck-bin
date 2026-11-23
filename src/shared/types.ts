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
  /** Protected paste: readable only through POST /documents/:id/unlock. */
  locked?: true;
  /** Private paste: readable by its owner (the signed-in creator) only. */
  private?: true;
}

/**
 * Protected pastes are encrypted in the browser; the server never sees the
 * passphrase. Both values are base64url: a 16-byte PBKDF2 salt and a 32-byte
 * unlock token derived from the passphrase (the server keeps only its SHA-256).
 * Sent as `lock` next to `content` in a JSON POST /documents body.
 */
export interface LockSpec {
  salt: string;
  token: string;
}

export const LOCK_SALT_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const LOCK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Wrong passphrases a protected paste survives; the last one deletes it. */
export const UNLOCK_ATTEMPTS = 10;

/** Body of POST /documents/:id/unlock. */
export interface UnlockRequest {
  token: string;
}

/**
 * 403 (wrong passphrase, attempts left) or 410 (that was the last attempt,
 * the paste is deleted) from POST /documents/:id/unlock.
 */
export interface UnlockRejected {
  message: string;
  attemptsLeft: number;
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
  /** The signed-in viewer created it (and may delete it). */
  mine?: true;
  /** Readable by its owner only. */
  private?: true;
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

/**
 * A protected paste: returned by GET /documents/:id and embedded by the page
 * render, without content. The salt lets the client derive the unlock token.
 */
export interface LockedPending {
  key: string;
  locked: true;
  salt: string;
  /** Also burn after reading: a successful unlock deletes it. */
  burn?: true;
  /** The signed-in viewer created it (and may delete it). */
  mine?: true;
}

export type EmbeddedPayload = GetResponse | EmbeddedNotFound | BurnPending | LockedPending;

/** GET /auth/me: whether sign-in is configured here, and who is signed in. */
export interface AuthState {
  enabled: boolean;
  user: { name: string } | null;
}

/**
 * Values of the short-lived pb_flash cookie the sign-in callback leaves for
 * the client to report: the sign-in failed, the account is not allowed, or
 * the identity provider could not be reached.
 */
export type AuthFlash = 'signin-failed' | 'denied' | 'unavailable';

/** One row of GET /documents (the signed-in user's own pastes), newest first. */
export interface OwnedPaste {
  key: string;
  /** ISO 8601. */
  createdAt: string;
  expiresAt: string | null;
  /** Content size in bytes. */
  size: number;
  burn?: true;
  locked?: true;
  private?: true;
  /** First non-blank line, shortened; absent for burn and protected pastes. */
  preview?: string;
}

export interface OwnedList {
  items: OwnedPaste[];
  /** Cursor for the next page: pass as ?before=. */
  next?: string;
}
