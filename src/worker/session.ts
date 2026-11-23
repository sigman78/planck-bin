/**
 * Sessions: a stateless HMAC-signed cookie, no sessions table. Verifying one
 * is pure CPU, so anonymous requests pay nothing and signed-in reads keep
 * working while the identity provider is down.
 *
 * Sealed values are base64url(JSON) + "." + base64url(HMAC-SHA256), with the
 * purpose ("session", "tx") inside the MAC input, so a sign-in transaction
 * cookie can never pass as a session. Not encrypted: the payload holds only
 * what its own user may read.
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { fromBase64Url, toBase64Url } from '../shared/base64url';
import { getAuthConfig, type AuthConfig } from './config';
import type { Env } from './types';

type AppContext = Context<{ Bindings: Env }>;

export type SealPurpose = 'session' | 'tx';

export interface Session {
  v: 1;
  /** Stable pseudonymous id: see uidOf. */
  uid: string;
  /** Display name for the palette. */
  name: string;
  email?: string;
  /** The provider reported `email` as verified; absent = not verified. */
  ev?: true;
  /** Unix seconds. */
  iat: number;
  exp: number;
}

export const SESSION_TTL = 30 * 24 * 60 * 60;

export const SESSION_COOKIE = 'pb_session';
export const TX_COOKIE = 'pb_tx';
/** Readable by the page: tells the client a session may exist. Not security-bearing. */
export const HINT_COOKIE = 'pb_in';
/** Readable by the page: a sign-in outcome to report once (AuthFlash). */
export const FLASH_COOKIE = 'pb_flash';

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    keys.set(secret, key);
  }
  return key;
}

export async function seal(purpose: SealPurpose, payload: object, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${purpose}.${body}`)
  );
  return `${body}.${toBase64Url(new Uint8Array(mac))}`;
}

/** The payload, or null when the value is malformed, forged, for another purpose or expired. */
export async function unseal<T extends { exp: number }>(
  purpose: SealPurpose,
  value: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): Promise<T | null> {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(value.slice(dot + 1)),
      encoder.encode(`${purpose}.${body}`)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T;
    if (typeof payload?.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** base64url of the first 16 bytes of SHA-256(iss NUL sub): stable, and says nothing about who. */
export async function uidOf(issuer: string, subject: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${issuer}\0${subject}`));
  return toBase64Url(new Uint8Array(digest).subarray(0, 16));
}

/** Whether an account may sign in: anyone, or a verified email on the allowlist. */
export function isAllowed(
  config: AuthConfig,
  email: string | undefined,
  emailVerified: boolean
): boolean {
  if (config.allowedEmails === null) return true;
  return emailVerified && !!email && config.allowedEmails.includes(email.toLowerCase());
}

/**
 * Cookie flags for this request. Over https the HttpOnly cookies get the
 * __Host- prefix (Secure, Path=/, no Domain: no subdomain can plant one);
 * plain http (local dev) cannot carry Secure cookies, so it gets neither.
 */
function isSecure(c: AppContext): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function cookieOptions(c: AppContext, maxAge: number, httpOnly: boolean): CookieOptions {
  const secure = isSecure(c);
  return {
    path: '/',
    httpOnly,
    secure,
    sameSite: 'Lax',
    maxAge,
    ...(secure && httpOnly ? { prefix: 'host' as const } : {}),
  };
}

function readCookie(c: AppContext, name: string): string | undefined {
  return isSecure(c) ? getCookie(c, name, 'host') : getCookie(c, name);
}

function clearCookie(c: AppContext, name: string, httpOnly: boolean): void {
  const { maxAge: _maxAge, ...options } = cookieOptions(c, 0, httpOnly);
  deleteCookie(c, name, options);
}

export function setSessionCookies(c: AppContext, sealed: string, maxAge: number): void {
  setCookie(c, SESSION_COOKIE, sealed, cookieOptions(c, maxAge, true));
  setCookie(c, HINT_COOKIE, '1', cookieOptions(c, maxAge, false));
}

export function clearSessionCookies(c: AppContext): void {
  clearCookie(c, SESSION_COOKIE, true);
  clearCookie(c, HINT_COOKIE, false);
}

export function setTxCookie(c: AppContext, sealed: string, maxAge: number): void {
  setCookie(c, TX_COOKIE, sealed, cookieOptions(c, maxAge, true));
}

export function readTxCookie(c: AppContext): string | undefined {
  return readCookie(c, TX_COOKIE);
}

export function clearTxCookie(c: AppContext): void {
  clearCookie(c, TX_COOKIE, true);
}

export function setFlashCookie(c: AppContext, value: string): void {
  setCookie(c, FLASH_COOKIE, value, cookieOptions(c, 60, false));
}

export async function createSession(
  config: AuthConfig,
  identity: { uid: string; name: string; email?: string; ev?: true },
  now = Math.floor(Date.now() / 1000)
): Promise<{ session: Session; sealed: string }> {
  const session: Session = { v: 1, ...identity, iat: now, exp: now + SESSION_TTL };
  return { session, sealed: await seal('session', session, config.sessionSecret) };
}

const viewers = new WeakMap<Request, Promise<Session | null>>();

/**
 * The signed-in user of this request, or null (no cookie, a bad one, sign-in
 * off, or an account no longer on the allowlist). Resolved once per request.
 */
export function viewerOf(c: AppContext): Promise<Session | null> {
  let viewer = viewers.get(c.req.raw);
  if (!viewer) {
    viewer = resolveViewer(c);
    viewers.set(c.req.raw, viewer);
  }
  return viewer;
}

async function resolveViewer(c: AppContext): Promise<Session | null> {
  const config = getAuthConfig(c.env);
  if (!config) return null;
  const value = readCookie(c, SESSION_COOKIE);
  if (!value) return null;
  const session = await unseal<Session>('session', value, config.sessionSecret);
  if (!session || session.v !== 1 || typeof session.uid !== 'string') return null;
  // The allowlist is configuration: removing an email takes effect at once.
  // A session from before the allowlist may carry an unverified email: it must not pass.
  if (config.allowedEmails !== null && !isAllowed(config, session.email, session.ev === true)) {
    return null;
  }
  return session;
}

/** uid of the signed-in user, or null: the `viewer` argument of every store read. */
export async function viewerId(c: AppContext): Promise<string | null> {
  return (await viewerOf(c))?.uid ?? null;
}
