/** A stored document; timestamps are unix seconds. */
export interface StoredDocument {
  content: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface DocumentStore {
  /** Fetch a document, or null if missing/expired. */
  get(key: string): Promise<StoredDocument | null>;
  /** Atomically insert content under a fresh unique key and return that key. */
  create(content: string, keyOptions: KeyOptions, expireDays?: number): Promise<string>;
  /** Bump the view counter (best-effort, safe to run in the background). */
  incrementViews(key: string): Promise<void>;
  /** Delete expired documents, returning how many were removed. */
  cleanup(): Promise<number>;
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
  CREATE_RATE_LIMITER: RateLimit;
  READ_RATE_LIMITER: RateLimit;
}
