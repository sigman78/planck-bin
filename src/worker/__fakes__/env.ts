/**
 * Minimal in-memory stand-ins for the worker bindings (D1, ASSETS, rate limiters).
 */

import type { Env } from '../types';

export interface FakeRow {
  content: string;
  created_at: number;
  expires_at: number | null;
  /** 1 = burn after reading. */
  burn?: number;
}

export interface FakeEnvOptions {
  rows?: Record<string, FakeRow>;
  assets?: Record<string, string>;
  vars?: Partial<Env>;
  readAllowed?: boolean;
  dbError?: boolean;
  /** Database size that every run() reports (meta.size_after). */
  sizeAfter?: number;
}

export interface FakeEnv {
  env: Env;
  /** Keys looked up with SELECT, in order. */
  lookups: string[];
  /** Characters of content returned by SELECTs (what left the database). */
  contentChars: () => number;
  /** SQL of every run() call (writes, plus SELECT 1 size checks), in order. */
  writes: string[];
  /** Every run() call with its bound arguments, in order. */
  runs: { sql: string; args: unknown[] }[];
  /** The fake table, mutated by DELETE ... RETURNING. */
  rows: Record<string, FakeRow>;
  ctx: ExecutionContext;
}

export function fakeEnv(options: FakeEnvOptions = {}): FakeEnv {
  const rows = options.rows ?? {};
  const assets = options.assets ?? {};
  const lookups: string[] = [];
  const writes: string[] = [];
  const runs: { sql: string; args: unknown[] }[] = [];
  let contentChars = 0;

  // Mirrors the stores' `expires_at IS NULL OR expires_at > ?2` filter.
  const live = (row: FakeRow, now: unknown) =>
    row.expires_at === null || row.expires_at > Number(now);

  const statement = (sql: string, args: unknown[]) => ({
    async first() {
      if (options.dbError) throw new Error('D1 unavailable');
      const key = String(args[0]);
      lookups.push(key);
      const row = rows[key];
      // take: DELETE ... WHERE burn = 1 ... RETURNING
      if (/^\s*DELETE/i.test(sql) && /RETURNING/i.test(sql)) {
        if (!row || !row.burn || !live(row, args[1])) return null;
        delete rows[key];
        contentChars += row.content.length;
        return { ...row, burn: 1 };
      }
      if (!/^\s*SELECT/i.test(sql)) return null;
      if (!row || !live(row, args[1])) return null;
      const burn = row.burn ?? 0;
      // getWithin: CASE WHEN ... LENGTH(content) <= ?3 THEN content END
      const limited = /LENGTH\(content\) <= \?3/.test(sql);
      const hidden = burn === 1 && /CASE WHEN burn = 0/.test(sql);
      const tooLarge = limited && row.content.length > Number(args[2]);
      const content = hidden || tooLarge ? null : row.content;
      contentChars += content?.length ?? 0;
      return { ...row, burn, content };
    },
    async run() {
      writes.push(sql);
      runs.push({ sql, args });
      return { meta: { changes: 1, size_after: options.sizeAfter ?? 0 } };
    },
  });

  const db = {
    prepare(sql: string) {
      return { ...statement(sql, []), bind: (...args: unknown[]) => statement(sql, args) };
    },
  };

  const assetsBinding = {
    async fetch(input: RequestInfo | URL) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = assets[url.pathname];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"shell-etag"' },
      });
    },
  };

  const limiter = (allowed: boolean) => ({
    async limit() {
      return { success: allowed };
    },
  });

  const env = {
    MAX_PASTE_SIZE: '400000',
    KEY_LENGTH: '10',
    DEFAULT_EXPIRE_DAYS: '30',
    DB: db,
    ASSETS: assetsBinding,
    CREATE_RATE_LIMITER: limiter(true),
    READ_RATE_LIMITER: limiter(options.readAllowed ?? true),
    ...options.vars,
  } as unknown as Env;

  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      void promise;
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;

  return { env, lookups, writes, runs, rows, ctx, contentChars: () => contentChars };
}
