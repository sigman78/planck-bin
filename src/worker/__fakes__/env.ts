/**
 * Minimal in-memory stand-ins for the worker bindings (D1, ASSETS, rate limiters).
 */

import type { Env } from '../types';

export interface FakeRow {
  content: string;
  created_at: number;
  expires_at: number | null;
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
  ctx: ExecutionContext;
}

export function fakeEnv(options: FakeEnvOptions = {}): FakeEnv {
  const rows = options.rows ?? {};
  const assets = options.assets ?? {};
  const lookups: string[] = [];
  const writes: string[] = [];
  let contentChars = 0;

  const statement = (sql: string, args: unknown[]) => ({
    async first() {
      if (options.dbError) throw new Error('D1 unavailable');
      const key = String(args[0]);
      lookups.push(key);
      if (!/^\s*SELECT/i.test(sql)) return null;
      const row = rows[key];
      if (!row) return null;
      // getWithin: CASE WHEN LENGTH(content) <= ?3 THEN content END
      const limited = /LENGTH\(content\) <= \?3/.test(sql);
      const content = limited && row.content.length > Number(args[2]) ? null : row.content;
      contentChars += content?.length ?? 0;
      return { ...row, content };
    },
    async run() {
      writes.push(sql);
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

  return { env, lookups, writes, ctx, contentChars: () => contentChars };
}
