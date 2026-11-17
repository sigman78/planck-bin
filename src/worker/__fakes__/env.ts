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
}

export interface FakeEnv {
  env: Env;
  /** Keys looked up with SELECT, in order. */
  lookups: string[];
  ctx: ExecutionContext;
}

export function fakeEnv(options: FakeEnvOptions = {}): FakeEnv {
  const rows = options.rows ?? {};
  const assets = options.assets ?? {};
  const lookups: string[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (options.dbError) throw new Error('D1 unavailable');
              const key = String(args[0]);
              lookups.push(key);
              return /^\s*SELECT/i.test(sql) ? (rows[key] ?? null) : null;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
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
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;

  return { env, lookups, ctx };
}
