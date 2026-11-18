/** @jest-environment node */

import { getServerConfig, LIMITS } from '../config';
import { isValidKey } from '../documents';
import { generateKey } from '../storage';
import type { Env, KeyStrategy } from '../types';

const config = (vars: Partial<Record<keyof Env, string>>) =>
  getServerConfig(vars as unknown as Env);

describe('server config', () => {
  it('uses the defaults when variables are unset', () => {
    expect(config({})).toMatchObject({
      maxPasteSize: 400000,
      keyLength: 10,
      defaultExpireDays: 30,
      browserCacheMaxAge: 0,
    });
  });

  it('reads plain integers, with surrounding whitespace and a sign', () => {
    expect(config({ KEY_LENGTH: ' 12 ', DEFAULT_EXPIRE_DAYS: '+7' })).toMatchObject({
      keyLength: 12,
      defaultExpireDays: 7,
    });
  });

  it.each(['30days', '1e3', '12.5', 'abc', ''])('falls back to the default for %j', (value) => {
    expect(config({ DEFAULT_EXPIRE_DAYS: value }).defaultExpireDays).toBe(30);
  });

  it('clamps out-of-range values', () => {
    expect(
      config({
        MAX_PASTE_SIZE: '-5',
        KEY_LENGTH: '1000',
        DEFAULT_EXPIRE_DAYS: '-1',
        BROWSER_CACHE_MAX_AGE: '99999999999',
      })
    ).toMatchObject({
      maxPasteSize: LIMITS.maxPasteSize.min,
      keyLength: LIMITS.keyLength.max,
      defaultExpireDays: 0,
      browserCacheMaxAge: LIMITS.browserCacheMaxAge.max,
    });
    expect(config({ MAX_PASTE_SIZE: '5000000' }).maxPasteSize).toBe(LIMITS.maxPasteSize.max);
    expect(config({ KEY_LENGTH: '2' }).keyLength).toBe(LIMITS.keyLength.min);
  });

  it.each<KeyStrategy>(['pronounceable', 'random', 'uuid'])(
    'keys of strategy %s at every allowed length can be read back',
    (strategy) => {
      // Even an absurd KEY_LENGTH must not produce keys that loadDocument rejects.
      const { keyLength } = config({ KEY_LENGTH: '100000' });
      for (let length = LIMITS.keyLength.min; length <= keyLength; length++) {
        expect(isValidKey(generateKey(strategy, length))).toBe(true);
      }
    }
  );

  it('accepts unquoted TOML values, which arrive as numbers and booleans', () => {
    const env = { KEY_LENGTH: 12, SERVER_RENDER: true, COUNT_VIEWS: false } as unknown as Env;
    expect(getServerConfig(env)).toMatchObject({
      keyLength: 12,
      serverRender: true,
      countViews: false,
    });
  });
});
