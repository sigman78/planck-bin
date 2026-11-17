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
  browserCacheMaxAge: number;
  /** Render paste pages on the worker (content embedded in the HTML). */
  serverRender: boolean;
}

function keyStrategyVar(value: string | undefined): KeyStrategy {
  return value === 'random' || value === 'uuid' || value === 'pronounceable'
    ? value
    : 'pronounceable';
}

function boolVar(value: string | undefined, fallback: boolean): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'off') return false;
  return fallback;
}

function intVar(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getServerConfig(env: Env): ServerConfig {
  return {
    maxPasteSize: intVar(env.MAX_PASTE_SIZE, 400000),
    keyLength: intVar(env.KEY_LENGTH, 10),
    keyStrategy: keyStrategyVar(env.KEY_STRATEGY),
    defaultExpireDays: intVar(env.DEFAULT_EXPIRE_DAYS, 30),
    browserCacheMaxAge: intVar(env.BROWSER_CACHE_MAX_AGE, 0),
    serverRender: boolVar(env.SERVER_RENDER, false),
  };
}
