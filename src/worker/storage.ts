import {
  BURN_PENDING,
  type BurnPending,
  type CreateOptions,
  type CreatedDocument,
  type DocumentStore,
  type Env,
  type KeyOptions,
  type KeyStrategy,
  type StoredDocument,
} from './types';
import { capExpireDays, getServerConfig } from './config';

const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';
const VOWELS = 'aeiou';
const MIN_KEY_LENGTH = 6;
const MAX_CREATE_ATTEMPTS = 10;
/**
 * Cleanup deletes in batches so one statement never has to free an unbounded
 * backlog (rows can be 400 KB each). The batch cap keeps one run well inside
 * the per-invocation D1 query limit; whatever is left goes on the next run.
 */
export const CLEANUP_BATCH_SIZE = 500;
export const CLEANUP_MAX_BATCHES = 40;
const URL_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Generate a pronounceable random key, e.g. "tavelu-hasoq".
 * Uses crypto randomness; uniqueness is enforced at insert time.
 */
export function pronounceableKey(length: number): string {
  const keyLength = Math.max(length, MIN_KEY_LENGTH);
  const bytes = crypto.getRandomValues(new Uint8Array(keyLength));

  let key = '';
  for (let i = 0; i < keyLength; i++) {
    const pool = i % 3 === 1 ? VOWELS : CONSONANTS;
    key += pool[bytes[i] % pool.length];
    if (i % 6 === 5 && i < keyLength - 1) key += '-';
  }
  return key;
}

/** Generate a URL-safe key with six bits of entropy per character. */
export function urlSafeKey(length: number): string {
  const keyLength = Math.max(length, MIN_KEY_LENGTH);
  const bytes = crypto.getRandomValues(new Uint8Array(keyLength));
  return Array.from(bytes, (byte) => URL_SAFE_ALPHABET[byte & 63]).join('');
}

export function generateKey(strategy: KeyStrategy, length: number): string {
  switch (strategy) {
    case 'random':
      return urlSafeKey(length);
    case 'uuid':
      return crypto.randomUUID();
    case 'pronounceable':
      return pronounceableKey(length);
  }
}

export class D1DocumentStore implements DocumentStore {
  constructor(
    private db: D1Database,
    private defaultExpireDays: number = 30,
    private maxExpireDays: number = 0
  ) {}

  // Burn documents never leave D1 through get/getWithin: CASE WHEN burn = 0
  // keeps their content out of the result, and only take() reads it.

  async get(key: string): Promise<StoredDocument | BurnPending | null> {
    const now = Math.floor(Date.now() / 1000);

    const row = await this.db
      .prepare(
        `SELECT CASE WHEN burn = 0 THEN content END AS content, created_at, expires_at, burn
         FROM documents WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)`
      )
      .bind(key, now)
      .first<DocumentRow>();

    if (!row) return null;
    if (row.burn) return BURN_PENDING;
    return fromRow(row);
  }

  async getWithin(
    key: string,
    maxChars: number
  ): Promise<StoredDocument | BurnPending | 'too-large' | null> {
    const now = Math.floor(Date.now() / 1000);

    // content is NOT NULL, so a null here means it is over the limit.
    const row = await this.db
      .prepare(
        `SELECT CASE WHEN burn = 0 AND LENGTH(content) <= ?3 THEN content END AS content,
           created_at, expires_at, burn
         FROM documents WHERE id = ?1 AND (expires_at IS NULL OR expires_at > ?2)`
      )
      .bind(key, now, maxChars)
      .first<DocumentRow>();

    if (!row) return null;
    if (row.burn) return BURN_PENDING;
    if (row.content === null) return 'too-large';
    return fromRow(row);
  }

  async take(key: string): Promise<StoredDocument | null> {
    const now = Math.floor(Date.now() / 1000);

    // One statement decides the only reader: a concurrent take finds no row.
    const row = await this.db
      .prepare(
        `DELETE FROM documents
         WHERE id = ?1 AND burn = 1 AND (expires_at IS NULL OR expires_at > ?2)
         RETURNING content, created_at, expires_at, burn`
      )
      .bind(key, now)
      .first<DocumentRow>();

    return row ? fromRow(row) : null;
  }

  async incrementViews(key: string): Promise<void> {
    await this.db.prepare('UPDATE documents SET views = views + 1 WHERE id = ?').bind(key).run();
  }

  async create(
    content: string,
    keyOptions: KeyOptions,
    options: CreateOptions = {}
  ): Promise<CreatedDocument> {
    const now = Math.floor(Date.now() / 1000);
    const days = capExpireDays(options.expireDays ?? this.defaultExpireDays, this.maxExpireDays);
    const expiresAt = days > 0 ? now + days * 24 * 60 * 60 : null;

    // ON CONFLICT DO NOTHING makes the uniqueness check atomic: a colliding
    // key inserts zero rows and we retry, so an existing paste is never
    // silently overwritten.
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const key = generateKey(keyOptions.strategy, keyOptions.length);
      const result = await this.db
        .prepare(
          `INSERT INTO documents (id, content, created_at, expires_at, views, burn)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(id) DO NOTHING`
        )
        .bind(key, content, now, expiresAt, options.burn ? 1 : 0)
        .run();

      if (result.meta.changes > 0) {
        return { key, expiresAt };
      }
    }

    throw new Error('Failed to generate unique key after maximum attempts');
  }

  /** Every D1 result reports the database size after the query; SELECT 1 reads no rows. */
  async sizeBytes(): Promise<number> {
    return (await this.db.prepare('SELECT 1').run()).meta.size_after;
  }

  async cleanup(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const statement = this.db.prepare(
      `DELETE FROM documents WHERE id IN (
         SELECT id FROM documents WHERE expires_at IS NOT NULL AND expires_at <= ?1 LIMIT ?2
       )`
    );

    let deleted = 0;
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
      const { changes } = (await statement.bind(now, CLEANUP_BATCH_SIZE).run()).meta;
      deleted += changes;
      // A short batch means nothing expired is left.
      if (changes < CLEANUP_BATCH_SIZE) return deleted;
    }

    console.warn(
      `Cleanup stopped after ${CLEANUP_MAX_BATCHES} batches (${deleted} documents); ` +
        'the rest is removed on the next run'
    );
    return deleted;
  }
}

interface DocumentRow {
  content: string | null;
  created_at: number;
  expires_at: number | null;
  burn: number;
}

function fromRow(row: DocumentRow): StoredDocument {
  return { content: row.content ?? '', createdAt: row.created_at, expiresAt: row.expires_at };
}

export function createStore(env: Env): DocumentStore {
  const config = getServerConfig(env);
  return new D1DocumentStore(env.DB, config.defaultExpireDays, config.maxExpireDays);
}
