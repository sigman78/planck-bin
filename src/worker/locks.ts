/**
 * Server side of protected pastes. The browser encrypts the paste and derives
 * an unlock token from the passphrase; the worker stores the ciphertext, the
 * salt and SHA-256 of the token, and releases the ciphertext only to a request
 * that presents the token. The passphrase and the content key never arrive here.
 *
 * The token is already stretched (PBKDF2, 600k iterations, in the browser),
 * so one SHA-256 is enough to keep a database dump from yielding it.
 */

import { fromBase64Url, toBase64Url } from '../shared/base64url';
import { LOCK_SALT_PATTERN, LOCK_TOKEN_PATTERN, type LockSpec } from '../shared/types';

export function isLockSpec(value: unknown): value is LockSpec {
  if (!value || typeof value !== 'object') return false;
  const { salt, token } = value as Partial<Record<keyof LockSpec, unknown>>;
  return (
    typeof salt === 'string' &&
    LOCK_SALT_PATTERN.test(salt) &&
    typeof token === 'string' &&
    LOCK_TOKEN_PATTERN.test(token)
  );
}

export function isUnlockToken(value: unknown): value is string {
  return typeof value === 'string' && LOCK_TOKEN_PATTERN.test(value);
}

/** What the database keeps in place of the token: base64url(SHA-256(token bytes)). */
export async function verifierOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', fromBase64Url(token));
  return toBase64Url(new Uint8Array(digest));
}

/** Compare without an early exit, so timing says nothing about how much matched. */
export function sameVerifier(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
