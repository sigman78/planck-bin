/**
 * A D1Database backed by a real in-memory SQLite (node:sqlite) with every
 * migration applied, for tests whose SQL is the point (protected pastes:
 * attempt counting, RETURNING, concurrent guesses). Only first() and run()
 * are implemented, which is all the store uses.
 */

// The project has no @types/node; these are the few Node APIs used here.
declare const require: (id: string) => any;
declare const __dirname: string;

interface SqliteStatement {
  get(...args: unknown[]): Record<string, unknown> | undefined;
  run(...args: unknown[]): { changes: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

export interface SqliteD1 {
  db: D1Database;
  /** Direct access for assertions. */
  query(sql: string, ...args: unknown[]): Record<string, unknown> | undefined;
}

export function sqliteD1(): SqliteD1 {
  const { DatabaseSync } = require('node:sqlite');
  const fs = require('node:fs');
  const path = require('node:path');
  const raw: SqliteDatabase = new DatabaseSync(':memory:');

  const dir = path.join(__dirname, '..', '..', '..', 'migrations');
  for (const file of (fs.readdirSync(dir) as string[]).filter((f) => f.endsWith('.sql')).sort()) {
    raw.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  }

  // D1 binds booleans and undefined loosely; node:sqlite wants null for absent values.
  const normalize = (args: unknown[]) => args.map((a) => (a === undefined ? null : a));

  const statement = (sql: string, args: unknown[]) => ({
    async first<T>() {
      return (raw.prepare(sql).get(...normalize(args)) ?? null) as T | null;
    },
    async run() {
      const { changes } = raw.prepare(sql).run(...normalize(args));
      return { success: true, meta: { changes: Number(changes), size_after: 0 } };
    },
  });

  const db = {
    prepare(sql: string) {
      return { ...statement(sql, []), bind: (...args: unknown[]) => statement(sql, args) };
    },
  } as unknown as D1Database;

  return { db, query: (sql, ...args) => raw.prepare(sql).get(...args) };
}
