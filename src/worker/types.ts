/** A stored document; timestamps are unix seconds. */
export interface StoredDocument {
  content: string;
  createdAt: number;
  expiresAt: number | null;
  /** uid of the signed-in creator; null for anonymous pastes. */
  owner?: string | null;
  /** Readable by the owner only. */
  private?: boolean;
}

/** A burn-after-reading document found by get/getWithin; its content stays in D1. */
export const BURN_PENDING = 'burn-pending';
export type BurnPending = typeof BURN_PENDING;

/**
 * A protected document found by get/getWithin: its (encrypted) content stays
 * in D1 until an unlock with the right token.
 */
export interface LockedStub {
  locked: true;
  salt: string;
  burn: boolean;
  owner?: string | null;
  /** Set by the loader: the viewer owns it. */
  mine?: boolean;
}

/** What reserveUnlock hands back: everything needed to check and serve one attempt. */
export interface UnlockCandidate extends StoredDocument {
  verifier: string;
  burn: boolean;
  /** Attempts counted so far, including this one. */
  failures: number;
}

export interface CreateOptions {
  /** Lifetime in days, 0 = never; omitted = the store default. */
  expireDays?: number;
  /** Delete the document on its first full read (take). */
  burn?: boolean;
  /** Protected: the content is ciphertext, released only for the matching token. */
  lock?: { salt: string; verifier: string };
  /** uid of the signed-in creator. */
  owner?: string;
  /** Readable by the owner only (requires owner). */
  private?: boolean;
}

/** A row of the owner's list; content is reduced to a preview in the store. */
export interface OwnedRow {
  key: string;
  createdAt: number;
  expiresAt: number | null;
  size: number;
  burn: boolean;
  locked: boolean;
  private: boolean;
  /** Start of the content; null for burn and protected pastes. */
  head: string | null;
}

/** Keyset cursor of the owner's list: rows strictly older than this one. */
export interface OwnedCursor {
  createdAt: number;
  key: string;
}

export interface CreatedDocument {
  key: string;
  /** Unix seconds; null when it never expires. */
  expiresAt: number | null;
}

/**
 * Every read takes the viewer: the uid of the signed-in user, or null. A
 * private document is invisible (null, as if missing) to anyone but its owner.
 */
export interface DocumentStore {
  /**
   * Fetch a document, or null if missing/expired. A burn-after-reading
   * document is not read: it yields BURN_PENDING (use take to read it).
   */
  get(
    key: string,
    viewer: string | null
  ): Promise<StoredDocument | BurnPending | LockedStub | null>;
  /**
   * Like get, but leaves content longer than `maxChars` characters in the
   * database and returns 'too-large' instead.
   */
  getWithin(
    key: string,
    maxChars: number,
    viewer: string | null
  ): Promise<StoredDocument | BurnPending | LockedStub | 'too-large' | null>;
  /**
   * Atomically delete a burn-after-reading document and return it; null when
   * it is missing, expired, not a burn document, protected, or another read
   * won the race.
   */
  take(key: string, viewer: string | null): Promise<StoredDocument | null>;
  /**
   * Count one unlock attempt of a protected document and return it, in one
   * statement, so concurrent guesses can never exceed `maxAttempts`. Null when
   * it is missing, expired, not protected, or out of attempts.
   */
  reserveUnlock(
    key: string,
    maxAttempts: number,
    viewer: string | null
  ): Promise<UnlockCandidate | null>;
  /** Undo the count of an attempt that turned out to be right. */
  releaseUnlock(key: string): Promise<void>;
  /** Like take, for a protected burn document after a successful unlock. */
  takeLocked(key: string, viewer: string | null): Promise<StoredDocument | null>;
  /** Delete a document outright (a protected one out of attempts). */
  remove(key: string): Promise<void>;
  /** Delete the owner's document; false when it is missing or someone else's. */
  removeOwned(key: string, owner: string): Promise<boolean>;
  /** The owner's live documents, newest first, older than `before` if given. */
  listOwned(owner: string, before: OwnedCursor | null, limit: number): Promise<OwnedRow[]>;
  /** Atomically insert content under a fresh unique key. */
  create(
    content: string,
    keyOptions: KeyOptions,
    options?: CreateOptions
  ): Promise<CreatedDocument>;
  /** Bump the view counter (best-effort, safe to run in the background). */
  incrementViews(key: string): Promise<void>;
  /** Delete expired documents, returning how many were removed. */
  cleanup(): Promise<number>;
  /** Current database size in bytes. */
  sizeBytes(): Promise<number>;
}

export type KeyStrategy = 'pronounceable' | 'random' | 'uuid';

export interface KeyOptions {
  strategy: KeyStrategy;
  length: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MAX_PASTE_SIZE: string;
  KEY_LENGTH: string;
  DEFAULT_EXPIRE_DAYS: string;
  KEY_STRATEGY?: string;
  BROWSER_CACHE_MAX_AGE?: string;
  SERVER_RENDER?: string;
  COUNT_VIEWS?: string;
  MAX_STORAGE_MB?: string;
  MAX_EXPIRE_DAYS?: string;
  /** Sign-in (OIDC); all four must be set, or sign-in is off. Set as secrets. */
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  /** Comma-separated emails allowed to sign in; unset = any account at the issuer. */
  OIDC_ALLOWED_EMAILS?: string;
  CREATE_RATE_LIMITER: RateLimit;
  READ_RATE_LIMITER: RateLimit;
}
