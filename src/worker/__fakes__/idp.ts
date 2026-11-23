/**
 * A fake OpenID provider for worker tests: real RS256/ES256 keys, a stubbed
 * globalThis.fetch that answers discovery, JWKS and the token endpoint, and
 * helpers to mint ID tokens (including deliberately broken ones).
 */

import { toBase64Url } from '../../shared/base64url';
import { resetOidcCaches } from '../oidc';

export const ISSUER = 'https://id.example.test';
export const CLIENT_ID = 'planck-test';
export const CLIENT_SECRET = 'client-secret-value';
export const SESSION_SECRET = 'test-session-secret-0123456789abcdef';

export const AUTH_VARS = {
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  SESSION_SECRET,
};

const enc = new TextEncoder();
const b64json = (value: unknown) => toBase64Url(enc.encode(JSON.stringify(value)));

export interface SigningKey {
  kid: string;
  alg: 'RS256' | 'ES256';
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
}

export async function makeKey(alg: 'RS256' | 'ES256', kid: string): Promise<SigningKey> {
  const params =
    alg === 'RS256'
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        }
      : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, alg, privateKey: pair.privateKey, publicJwk: { ...jwk, kid, alg, use: 'sig' } };
}

export async function signJwt(
  key: SigningKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {}
): Promise<string> {
  const head = b64json({ alg: key.alg, typ: 'JWT', kid: key.kid, ...header });
  const body = b64json(claims);
  const algorithm =
    key.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  const sig = await crypto.subtle.sign(algorithm, key.privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export function claimsFor(nonce: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: 'user-1',
    aud: CLIENT_ID,
    iat: now,
    exp: now + 300,
    nonce,
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    email_verified: true,
    ...extra,
  };
}

export interface FakeIdp {
  keys: SigningKey[];
  /** Requests the stub received, as "METHOD url". */
  calls: string[];
  /** Body of the last token request. */
  lastTokenRequest: URLSearchParams | null;
  /** Returns the id_token for a code exchange; default: a valid token for the nonce. */
  tokenFor: (nonce: string) => Promise<string>;
  /** Make every request to the provider fail (network error). */
  down: boolean;
  restore(): void;
}

/**
 * Install the stub. The token endpoint needs the nonce of the sign-in in
 * progress: the test passes it via `idp.nonce` after reading the redirect.
 */
export async function installFakeIdp(): Promise<FakeIdp & { nonce: string }> {
  resetOidcCaches();
  const rsa = await makeKey('RS256', 'rsa-1');
  const original = globalThis.fetch;
  const idp: FakeIdp & { nonce: string } = {
    keys: [rsa],
    calls: [],
    lastTokenRequest: null,
    nonce: '',
    down: false,
    tokenFor: (nonce) => signJwt(rsa, claimsFor(nonce)),
    restore: () => {
      globalThis.fetch = original;
      resetOidcCaches();
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    idp.calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (idp.down) throw new TypeError('fetch failed');
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      });
    }
    if (url === `${ISSUER}/jwks`) {
      return Response.json({ keys: idp.keys.map((k) => k.publicJwk) });
    }
    if (url === `${ISSUER}/token`) {
      idp.lastTokenRequest = new URLSearchParams(String(init?.body ?? ''));
      return Response.json({ id_token: await idp.tokenFor(idp.nonce), token_type: 'Bearer' });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return idp;
}
