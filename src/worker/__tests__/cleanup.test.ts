/** @jest-environment node */

import { CLEANUP_BATCH_SIZE, CLEANUP_MAX_BATCHES, D1DocumentStore } from '../storage';

/** A D1 stand-in holding `expired` rows that DELETE ... LIMIT ?2 removes in batches. */
function fakeDb(expired: number) {
  let remaining = expired;
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              statements.push({ sql, args });
              const changes = Math.min(remaining, Number(args[1]));
              remaining -= changes;
              return { meta: { changes } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements, remaining: () => remaining };
}

describe('cleanup', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('deletes in batches until a short batch', async () => {
    const fake = fakeDb(CLEANUP_BATCH_SIZE * 2 + 7);
    const deleted = await new D1DocumentStore(fake.db).cleanup();

    expect(deleted).toBe(CLEANUP_BATCH_SIZE * 2 + 7);
    expect(fake.statements).toHaveLength(3);
    expect(fake.remaining()).toBe(0);
    expect(fake.statements[0].sql).toMatch(/LIMIT \?2/);
    expect(fake.statements[0].args[1]).toBe(CLEANUP_BATCH_SIZE);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('runs one statement when nothing has expired', async () => {
    const fake = fakeDb(0);
    expect(await new D1DocumentStore(fake.db).cleanup()).toBe(0);
    expect(fake.statements).toHaveLength(1);
  });

  it('runs one more statement after an exactly full batch', async () => {
    const fake = fakeDb(CLEANUP_BATCH_SIZE);
    expect(await new D1DocumentStore(fake.db).cleanup()).toBe(CLEANUP_BATCH_SIZE);
    expect(fake.statements).toHaveLength(2);
  });

  it('stops at the batch cap and leaves the rest for the next run', async () => {
    const cap = CLEANUP_BATCH_SIZE * CLEANUP_MAX_BATCHES;
    const fake = fakeDb(cap + 1);

    expect(await new D1DocumentStore(fake.db).cleanup()).toBe(cap);
    expect(fake.statements).toHaveLength(CLEANUP_MAX_BATCHES);
    expect(fake.remaining()).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
