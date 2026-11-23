import {
  BURN_PENDING,
  type BurnPending,
  type CreateOptions,
  type CreatedDocument,
  type DocumentStore,
  type Env,
  type KeyOptions,
  type KeyStrategy,
  type LockedStub,
  type OwnedCursor,
  type OwnedRow,
  type StoredDocument,
  type UnlockCandidate,
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

  // Burn and protected documents never leave D1 through get/getWithin: the
  // CASE WHEN keeps their content out of the result. Only take() reads a burn
  // document, and only an unlock reads a protected one.
  //
  // Private documents: every read carries visible(), so for anyone but the
  // owner the row does not exist. The viewer is always the last bind.

  async get(
    key: string,
    viewer: string | null
  ): Promise<StoredDocument | BurnPending | LockedStub | null> {
    const now = Math.floor(Date.now() / 1000);

    const row = await this.db
      .prepare(
        `SELECT CASE WHEN burn = 0 AND lock_salt IS NULL THEN content END AS content,
           created_at, expires_at, burn, lock_salt, owner, private
         FROM documents WHERE id = ?1 AND (expires_at IS NULL OR expires_at > ?2)
           AND ${visible(3)}`
      )
      .bind(key, now, viewer)
      .first<DocumentRow>();

    if (!row) return null;
    if (row.lock_salt) return lockedStub(row);
    if (row.burn) return BURN_PENDING;
    return fromRow(row);
  }

  async getWithin(
    key: string,
    maxChars: number,
    viewer: string | null
  ): Promise<StoredDocument | BurnPending | LockedStub | 'too-large' | null> {
    const now = Math.floor(Date.now() / 1000);

    // content is NOT NULL, so a null here means it is over the limit.
    const row = await this.db
      .prepare(
        `SELECT CASE WHEN burn = 0 AND lock_salt IS NULL AND LENGTH(content) <= ?3
             THEN content END AS content,
           created_at, expires_at, burn, lock_salt, owner, private
         FROM documents WHERE id = ?1 AND (expires_at IS NULL OR expires_at > ?2)
           AND ${visible(4)}`
      )
      .bind(key, now, maxChars, viewer)
      .first<DocumentRow>();

    if (!row) return null;
    if (row.lock_salt) return lockedStub(row);
    if (row.burn) return BURN_PENDING;
    if (row.content === null) return 'too-large';
    return fromRow(row);
  }

  async take(key: string, viewer: string | null): Promise<StoredDocument | null> {
    const now = Math.floor(Date.now() / 1000);

    // One statement decides the only reader: a concurrent take finds no row.
    const row = await this.db
      .prepare(
        `DELETE FROM documents
         WHERE id = ?1 AND burn = 1 AND lock_salt IS NULL
           AND (expires_at IS NULL OR expires_at > ?2) AND ${visible(3)}
         RETURNING content, created_at, expires_at, burn, owner, private`
      )
      .bind(key, now, viewer)
      .first<DocumentRow>();

    return row ? fromRow(row) : null;
  }

  async reserveUnlock(
    key: string,
    maxAttempts: number,
    viewer: string | null
  ): Promise<UnlockCandidate | null> {
    const now = Math.floor(Date.now() / 1000);

    // Counting before checking makes the cap exact: N concurrent guesses
    // spend N attempts, and the one that reaches the cap sees it.
    const row = await this.db
      .prepare(
        `UPDATE documents SET lock_failures = lock_failures + 1
         WHERE id = ?1 AND lock_salt IS NOT NULL AND lock_failures < ?3
           AND (expires_at IS NULL OR expires_at > ?2) AND ${visible(4)}
         RETURNING content, created_at, expires_at, burn, owner, private,
           lock_verifier, lock_failures`
      )
      .bind(key, now, maxAttempts, viewer)
      .first<DocumentRow & { lock_verifier: string; lock_failures: number }>();

    if (!row) return null;
    return {
      ...fromRow(row),
      verifier: row.lock_verifier,
      burn: row.burn === 1,
      failures: row.lock_failures,
    };
  }

  async releaseUnlock(key: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE documents SET lock_failures = lock_failures - 1 WHERE id = ? AND lock_failures > 0'
      )
      .bind(key)
      .run();
  }

  async takeLocked(key: string, viewer: string | null): Promise<StoredDocument | null> {
    const now = Math.floor(Date.now() / 1000);

    const row = await this.db
      .prepare(
        `DELETE FROM documents
         WHERE id = ?1 AND burn = 1 AND lock_salt IS NOT NULL
           AND (expires_at IS NULL OR expires_at > ?2) AND ${visible(3)}
         RETURNING content, created_at, expires_at, burn, owner, private`
      )
      .bind(key, now, viewer)
      .first<DocumentRow>();

    return row ? fromRow(row) : null;
  }

  async remove(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM documents WHERE id = ?').bind(key).run();
  }

  async removeOwned(key: string, owner: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM documents WHERE id = ? AND owner = ?')
      .bind(key, owner)
      .run();
    return result.meta.changes > 0;
  }

  async listOwned(owner: string, before: OwnedCursor | null, limit: number): Promise<OwnedRow[]> {
    const now = Math.floor(Date.now() / 1000);
    // Keyset paging on the (owner, created_at, id) index. The head is cut in
    // SQL, so a 400 KB paste sends only its start; burn and protected rows send none.
    const { results } = await this.db
      .prepare(
        `SELECT id, created_at, expires_at, burn, private,
           lock_salt IS NOT NULL AS locked,
           LENGTH(CAST(content AS BLOB)) AS size,
           CASE WHEN burn = 0 AND lock_salt IS NULL THEN substr(content, 1, ${HEAD_CHARS}) END
             AS head
         FROM documents
         WHERE owner = ?1 AND (expires_at IS NULL OR expires_at > ?2)
           AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND id < ?4))
         ORDER BY created_at DESC, id DESC
         LIMIT ?5`
      )
      .bind(owner, now, before?.createdAt ?? null, before?.key ?? null, limit)
      .all<OwnedSqlRow>();
    return results.map((r) => ({
      key: r.id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      size: r.size,
      burn: r.burn === 1,
      locked: r.locked === 1,
      private: r.private === 1,
      head: r.head,
    }));
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
          `INSERT INTO documents
             (id, content, created_at, expires_at, views, burn, lock_salt, lock_verifier,
              owner, private)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`
        )
        .bind(
          key,
          content,
          now,
          expiresAt,
          options.burn ? 1 : 0,
          options.lock?.salt ?? null,
          options.lock?.verifier ?? null,
          options.owner ?? null,
          options.private ? 1 : 0
        )
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

/** Characters of content the owner's list reads per row (the client shows one line). */
const HEAD_CHARS = 200;

/** Public, or owned by the viewer bound at ?n (a NULL viewer owns nothing). */
function visible(n: number): string {
  return `(private = 0 OR owner = ?${n})`;
}

interface DocumentRow {
  content: string | null;
  created_at: number;
  expires_at: number | null;
  burn: number;
  lock_salt?: string | null;
  owner?: string | null;
  private?: number;
}

interface OwnedSqlRow {
  id: string;
  created_at: number;
  expires_at: number | null;
  burn: number;
  private: number;
  locked: number;
  size: number;
  head: string | null;
}

function lockedStub(row: DocumentRow): LockedStub {
  return { locked: true, salt: row.lock_salt!, burn: row.burn === 1, owner: row.owner ?? null };
}

function fromRow(row: DocumentRow): StoredDocument {
  return {
    content: row.content ?? '',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    owner: row.owner ?? null,
    private: row.private === 1,
  };
}

export function createStore(env: Env): DocumentStore {
  const config = getServerConfig(env);
  return new D1DocumentStore(env.DB, config.defaultExpireDays, config.maxExpireDays);
}
