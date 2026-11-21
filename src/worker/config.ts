import type { Env, KeyStrategy } from './types';

/**
 * All env-var parsing lives here so routes never touch raw strings
 * or repeat fallback values.
 */
export interface ServerConfig {
  maxPasteSize: number;
  keyLength: number;
  keyStrategy: KeyStrategy;
  defaultExpireDays: number;
  /** Upper bound for any paste lifetime, including "never"; 0 = no cap. */
  maxExpireDays: number;
  browserCacheMaxAge: number;
  /** Render paste pages on the worker (content embedded in the HTML). */
  serverRender: boolean;
  /** Bump documents.views on full reads (one D1 write per read). */
  countViews: boolean;
  /** Refuse new pastes once the database reaches this size; 0 = no limit. */
  maxStorageBytes: number;
}

function keyStrategyVar(value: string | undefined): KeyStrategy {
  return value === 'random' || value === 'uuid' || value === 'pronounceable'
    ? value
    : 'pronounceable';
}

// Values are typed as strings, but wrangler passes unquoted TOML values
// (KEY_LENGTH = 12, SERVER_RENDER = true) as numbers and booleans.
function boolVar(value: unknown, fallback: boolean): boolean {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (v === 'true' || v === '1' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'off') return false;
  return fallback;
}

/**
 * Bounds for numeric settings. Out-of-range values are clamped; values that are
 * not plain integers (e.g. "30days") fall back to the default.
 */
export const LIMITS = {
  /** D1 caps a row at 2 MB; leave room for the other columns. */
  maxPasteSize: { min: 1, max: 1_900_000 },
  /**
   * Pronounceable keys add a hyphen every six characters, so 48 becomes 55
   * characters, inside the 64 that loadDocument accepts.
   */
  keyLength: { min: 6, max: 48 },
  /** 0 = never expire. */
  defaultExpireDays: { min: 0, max: 36_500 },
  /** 0 = no cap. */
  maxExpireDays: { min: 0, max: 36_500 },
  browserCacheMaxAge: { min: 0, max: 31_536_000 },
  /** 0 = no limit; D1 databases top out at 10 GB. */
  maxStorageMb: { min: 0, max: 10_240 },
} as const;

function intVar(
  value: unknown,
  fallback: number,
  { min, max }: { min: number; max: number }
): number {
  const text = String(value ?? '').trim();
  const parsed = /^[+-]?\d+$/.test(text) ? Number(text) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Apply the MAX_EXPIRE_DAYS cap to a lifetime in days (0 = never). */
export function capExpireDays(days: number, maxExpireDays: number): number {
  if (maxExpireDays <= 0) return days;
  return days === 0 ? maxExpireDays : Math.min(days, maxExpireDays);
}

export function getServerConfig(env: Env): ServerConfig {
  return {
    maxPasteSize: intVar(env.MAX_PASTE_SIZE, 400000, LIMITS.maxPasteSize),
    keyLength: intVar(env.KEY_LENGTH, 10, LIMITS.keyLength),
    keyStrategy: keyStrategyVar(env.KEY_STRATEGY),
    defaultExpireDays: intVar(env.DEFAULT_EXPIRE_DAYS, 30, LIMITS.defaultExpireDays),
    maxExpireDays: intVar(env.MAX_EXPIRE_DAYS, 0, LIMITS.maxExpireDays),
    browserCacheMaxAge: intVar(env.BROWSER_CACHE_MAX_AGE, 0, LIMITS.browserCacheMaxAge),
    serverRender: boolVar(env.SERVER_RENDER, false),
    countViews: boolVar(env.COUNT_VIEWS, false),
    maxStorageBytes: intVar(env.MAX_STORAGE_MB, 0, LIMITS.maxStorageMb) * 1024 * 1024,
  };
}
