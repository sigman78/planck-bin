/**
 * Sign-in routes (OIDC authorization code + PKCE, one configured issuer):
 *
 *   GET  /auth/login?return=/path  -> 302 to the identity provider
 *   GET  /auth/callback            -> session cookie, 303 back to the return path
 *   POST /auth/logout              -> clears the session (204)
 *   GET  /auth/me                  -> AuthState (works with sign-in off, too)
 *
 * The state, nonce, PKCE verifier and return path travel in a sealed,
 * short-lived transaction cookie, not in D1. Failures go back to the return
 * path with a pb_flash cookie for the client to report. Every response here
 * is no-store.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthFlash, AuthState } from '../shared/types';
import { getAuthConfig } from './config';
import {
  OidcError,
  authorizationUrl,
  discover,
  displayName,
  exchangeCode,
  isEmailVerified,
  pkceChallenge,
  randomToken,
  verifyIdToken,
} from './oidc';
import {
  SESSION_TTL,
  clearSessionCookies,
  clearTxCookie,
  createSession,
  isAllowed,
  readTxCookie,
  seal,
  setFlashCookie,
  setSessionCookies,
  setTxCookie,
  uidOf,
  unseal,
  viewerOf,
} from './session';
import type { Env } from './types';

type AppContext = Context<{ Bindings: Env }>;

/** Seconds a sign-in may take at the identity provider. */
const TX_TTL = 10 * 60;

interface Transaction {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

/**
 * The path to come back to: same origin only, as path + query + hash.
 * Anything else ("//evil", "/\\evil", absolute URLs, control characters) is "/".
 */
export function safeReturnPath(value: string | undefined | null, origin: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return '/';
  }
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}

function redirectUri(c: AppContext): string {
  return `${new URL(c.req.url).origin}/auth/callback`;
}

function noStore(c: AppContext): void {
  c.header('Cache-Control', 'no-store');
}

export const auth = new Hono<{ Bindings: Env }>();

auth.get('/auth/me', async (c) => {
  noStore(c);
  const config = getAuthConfig(c.env);
  const session = await viewerOf(c);
  if (config && session) {
    // Sliding renewal: past half its life, the session gets a fresh 30 days.
    const now = Math.floor(Date.now() / 1000);
    if (session.exp - now < SESSION_TTL / 2) {
      const renewed = await createSession(config, session);
      setSessionCookies(c, renewed.sealed, SESSION_TTL);
    }
  }
  const state: AuthState = {
    enabled: config !== null,
    user: session ? { name: session.name } : null,
  };
  return c.json(state);
});

auth.get('/auth/login', async (c) => {
  noStore(c);
  const config = getAuthConfig(c.env);
  if (!config) return c.json({ message: 'Sign-in is not configured' }, 404);

  const origin = new URL(c.req.url).origin;
  const returnTo = safeReturnPath(c.req.query('return'), origin);
  try {
    const metadata = await discover(config.issuer);
    const tx: Transaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
      returnTo,
      exp: Math.floor(Date.now() / 1000) + TX_TTL,
    };
    setTxCookie(c, await seal('tx', tx, config.sessionSecret), TX_TTL);
    const url = authorizationUrl(metadata, {
      clientId: config.clientId,
      redirectUri: redirectUri(c),
      state: tx.state,
      nonce: tx.nonce,
      challenge: await pkceChallenge(tx.verifier),
    });
    return c.redirect(url, 302);
  } catch (error) {
    console.error('Sign-in start failed:', error instanceof Error ? error.message : error);
    return failBack(c, returnTo, 'unavailable');
  }
});

function failBack(c: AppContext, returnTo: string, flash: AuthFlash): Response {
  setFlashCookie(c, flash);
  return c.redirect(returnTo, 303);
}

auth.get('/auth/callback', async (c) => {
  noStore(c);
  const config = getAuthConfig(c.env);
  if (!config) return c.json({ message: 'Sign-in is not configured' }, 404);

  // Single use: whatever happens next, this transaction is spent.
  const tx = await unseal<Transaction>('tx', readTxCookie(c), config.sessionSecret);
  clearTxCookie(c);
  if (!tx) return failBack(c, '/', 'signin-failed');
  const returnTo = safeReturnPath(tx.returnTo, new URL(c.req.url).origin);

  const error = c.req.query('error');
  if (error) return failBack(c, returnTo, error === 'access_denied' ? 'denied' : 'signin-failed');

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state || state !== tx.state) return failBack(c, returnTo, 'signin-failed');
  // RFC 9207: when the provider names itself, it must be ours (mix-up defense).
  const iss = c.req.query('iss');
  if (iss !== undefined && iss !== config.issuer) return failBack(c, returnTo, 'signin-failed');

  try {
    const metadata = await discover(config.issuer);
    const idToken = await exchangeCode(metadata, {
      code,
      redirectUri: redirectUri(c),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      verifier: tx.verifier,
    });
    const claims = await verifyIdToken(idToken, metadata, {
      issuer: config.issuer,
      clientId: config.clientId,
      nonce: tx.nonce,
    });
    if (!isAllowed(config, claims.email, isEmailVerified(claims))) {
      return failBack(c, returnTo, 'denied');
    }
    const { sealed } = await createSession(config, {
      uid: await uidOf(claims.iss, claims.sub),
      name: displayName(claims),
      ...(claims.email ? { email: claims.email } : {}),
    });
    setSessionCookies(c, sealed, SESSION_TTL);
    return c.redirect(returnTo, 303);
  } catch (err) {
    // Never log tokens or codes: the message names the failed check only.
    console.error('Sign-in failed:', err instanceof Error ? err.message : err);
    const unavailable = err instanceof OidcError && err.unavailable;
    return failBack(c, returnTo, unavailable ? 'unavailable' : 'signin-failed');
  }
});

auth.post('/auth/logout', (c) => {
  noStore(c);
  clearSessionCookies(c);
  return c.body(null, 204);
});

auth.all('/auth/me', (c) => {
  c.header('Allow', 'GET, HEAD');
  return c.json({ message: 'Method not allowed' }, 405);
});
auth.all('/auth/logout', (c) => {
  c.header('Allow', 'POST');
  return c.json({ message: 'Method not allowed' }, 405);
});
