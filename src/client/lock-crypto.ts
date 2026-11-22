/**
 * Protected pastes: encryption in the browser (WebCrypto only).
 *
 *   master = PBKDF2-SHA256(passphrase, salt, 600k iterations)
 *   token  = HKDF(master, "unlock")  -> sent to the server, which keeps SHA-256(token)
 *   key    = HKDF(master, "content") -> AES-256-GCM, never leaves the browser
 *
 * The server releases the ciphertext only for the right token and deletes the
 * paste after UNLOCK_ATTEMPTS wrong ones, so guessing online is capped. A
 * database dump still needs an offline search through the slow PBKDF2, which is
 * why generated passphrases have four words from a 7776-word list (51.7 bits).
 */

import { fromBase64Url, toBase64Url } from '../shared/base64url';
import type { LockSpec } from '../shared/types';

/** OWASP's PBKDF2-HMAC-SHA256 figure; well under a second on current hardware. */
export const PBKDF2_ITERATIONS = 600_000;
export const PASSPHRASE_WORDS = 4;
/** Shortest custom passphrase, counted after normalization. */
export const MIN_PASSPHRASE_LENGTH = 8;

const SALT_BYTES = 16;
const IV_BYTES = 12;
/** Format marker of the stored ciphertext: "v1." + base64url(iv || ciphertext). */
const ENVELOPE_V1 = 'v1.';
const encoder = new TextEncoder();
const AAD = encoder.encode('planck-bin/v1');

/**
 * One spelling per passphrase, so what was typed matches what was set:
 * Unicode NFKC, lowercase, and any run of spaces, dots, dashes or
 * underscores becomes one dash ("Maple Orbit" = "maple-orbit" = "maple.orbit").
 */
export function normalizePassphrase(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .join('-');
}

/** Words are drawn uniformly (rejection sampling, no modulo bias). */
export function generatePassphrase(words: readonly string[], count = PASSPHRASE_WORDS): string {
  const limit = Math.floor(0x1_0000_0000 / words.length) * words.length;
  const picked: string[] = [];
  const buffer = new Uint32Array(1);
  while (picked.length < count) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) picked.push(words[buffer[0] % words.length]);
  }
  return picked.join('-');
}

/** The EFF list, fetched only when a protected paste is created. */
export async function loadWordlist(): Promise<string[]> {
  const { EFF_LARGE_WORDLIST } = await import('./eff-wordlist');
  return EFF_LARGE_WORDLIST.split(' ');
}

interface DerivedLock {
  token: string;
  key: CryptoKey;
}

async function deriveLock(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<DerivedLock> {
  const subtle = crypto.subtle;
  const secret = await subtle.importKey(
    'raw',
    encoder.encode(normalizePassphrase(passphrase)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const master = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    secret,
    256
  );
  const hkdf = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const info = (label: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode(`planck-bin/v1/${label}`),
  });
  const token = await subtle.deriveBits(info('unlock'), hkdf, 256);
  const key = await subtle.deriveKey(
    info('content'),
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { token: toBase64Url(new Uint8Array(token)), key };
}

/** Encrypt `content` under `passphrase`: what POST /documents stores, and its lock. */
export async function lockContent(
  content: string,
  passphrase: string
): Promise<{ envelope: string; lock: LockSpec }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const { token, key } = await deriveLock(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    key,
    encoder.encode(content)
  );
  const packed = new Uint8Array(IV_BYTES + sealed.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(sealed), IV_BYTES);
  return {
    envelope: ENVELOPE_V1 + toBase64Url(packed),
    lock: { salt: toBase64Url(salt), token },
  };
}

/** The unlock token for `passphrase`, and a function that opens the ciphertext it releases. */
export async function openLock(
  passphrase: string,
  salt: string
): Promise<{ token: string; decrypt: (envelope: string) => Promise<string> }> {
  const { token, key } = await deriveLock(passphrase, fromBase64Url(salt));
  return { token, decrypt: (envelope) => decryptEnvelope(envelope, key) };
}

/** @throws Error when the envelope is malformed or does not open with `key` */
async function decryptEnvelope(envelope: string, key: CryptoKey): Promise<string> {
  if (!envelope.startsWith(ENVELOPE_V1)) throw new Error('Unknown ciphertext format');
  const packed = fromBase64Url(envelope.slice(ENVELOPE_V1.length));
  if (packed.length < IV_BYTES) throw new Error('Truncated ciphertext');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: packed.subarray(0, IV_BYTES), additionalData: AAD },
    key,
    packed.subarray(IV_BYTES)
  );
  return new TextDecoder().decode(plain);
}
