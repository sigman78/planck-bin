/**
 * A minimal OpenID Connect relying party for one configured issuer:
 * discovery, authorization code + PKCE, and ID token validation with
 * WebCrypto. Hand-rolled on purpose: the surface is one flow, and a library
 * would not check more than this does.
 *
 * Checked on every ID token: signature (RS256 or ES256 only, key from the
 * issuer's JWKS by kid), iss, aud (and azp with several audiences), exp,
 * iat and nonce, with CLOCK_SKEW seconds of slack. Tokens are discarded after
 * validation: no access or refresh token is kept.
 */

import { fromBase64Url, toBase64Url } from '../shared/base64url';

export const CLOCK_SKEW = 60;
const FETCH_TIMEOUT_MS = 5000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;
/** An unknown kid refetches the JWKS at most this often (key rotation). */
const JWKS_REFETCH_MS = 60 * 1000;

export interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat: number;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  email?: string;
  email_verified?: boolean | string;
}

export class OidcError extends Error {
  constructor(
    message: string,
    /** The identity provider could not be reached (as opposed to a bad answer). */
    readonly unavailable = false
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    throw new OidcError(`request to ${new URL(url).host} failed: ${String(error)}`, true);
  }
  if (!response.ok) {
    throw new OidcError(`${new URL(url).host} answered ${response.status}`, response.status >= 500);
  }
  try {
    return await response.json();
  } catch {
    throw new OidcError(`${new URL(url).host} sent invalid JSON`);
  }
}

// Per-isolate caches. A stale copy is served when a refresh fails.
const discoveryCache = new Map<string, { at: number; value: ProviderMetadata }>();
const jwksCache = new Map<string, { at: number; keys: Jwk[]; forcedAt: number }>();

/** For tests: forget cached discovery documents and key sets. */
export function resetOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

export async function discover(issuer: string): Promise<ProviderMetadata> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
  let doc: Partial<ProviderMetadata>;
  try {
    doc = (await fetchJson(
      `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
    )) as Partial<ProviderMetadata>;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
  // OIDC Discovery 4.3: the document must name exactly the issuer we asked.
  if (doc.issuer !== issuer) {
    throw new OidcError(`discovery issuer ${String(doc.issuer)} does not match ${issuer}`);
  }
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[field] !== 'string' || !doc[field]!.startsWith('https://')) {
      throw new OidcError(`discovery document lacks an https ${field}`);
    }
  }
  const value = doc as ProviderMetadata;
  discoveryCache.set(issuer, { at: Date.now(), value });
  return value;
}

/**
 * The issuer's keys. `refresh` (an unknown kid) bypasses the cache, but at
 * most once per JWKS_REFETCH_MS, so tokens with made-up kids cannot turn
 * into a stream of requests to the provider.
 */
async function jwks(uri: string, refresh: boolean): Promise<Jwk[]> {
  const cached = jwksCache.get(uri);
  const now = Date.now();
  if (cached) {
    const fresh = now - cached.at < JWKS_TTL_MS;
    if (fresh && (!refresh || now - cached.forcedAt < JWKS_REFETCH_MS)) return cached.keys;
  }
  try {
    const body = (await fetchJson(uri)) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
    jwksCache.set(uri, { at: now, keys, forcedAt: refresh ? now : (cached?.forcedAt ?? 0) });
    return keys;
  } catch (error) {
    if (cached) return cached.keys;
    throw error;
  }
}

const ALGORITHMS = {
  RS256: {
    kty: 'RSA',
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  ES256: {
    kty: 'EC',
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
} as const;
type Algorithm = keyof typeof ALGORITHMS;

function decodeJson<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as T;
  } catch {
    throw new OidcError('malformed ID token');
  }
}

async function findKey(uri: string, kid: string | undefined, alg: Algorithm): Promise<Jwk> {
  const pick = (keys: Jwk[]) =>
    keys.find(
      (k) =>
        k.kty === ALGORITHMS[alg].kty &&
        (k.use === undefined || k.use === 'sig') &&
        (k.alg === undefined || k.alg === alg) &&
        (alg !== 'ES256' || k.crv === 'P-256') &&
        (kid === undefined || k.kid === kid)
    );
  const key = pick(await jwks(uri, false)) ?? pick(await jwks(uri, true));
  if (!key) throw new OidcError(`no ${alg} signing key ${kid ?? ''} in the issuer's JWKS`);
  return key;
}

export interface ExpectedClaims {
  issuer: string;
  clientId: string;
  nonce: string;
  now?: number;
}

export async function verifyIdToken(
  token: string,
  metadata: ProviderMetadata,
  expected: ExpectedClaims
): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('malformed ID token');
  const header = decodeJson<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  const alg = header.alg;
  // An allowlist: "none", HS256 (with the public key as secret) and the rest never verify.
  if (alg !== 'RS256' && alg !== 'ES256') throw new OidcError(`ID token algorithm ${alg}`);

  const jwk = await findKey(metadata.jwks_uri, header.kid, alg);
  let key: CryptoKey;
  try {
    const { kty, n, e, crv, x, y } = jwk;
    key = await crypto.subtle.importKey(
      'jwk',
      { kty, n, e, crv, x, y, ext: true },
      ALGORITHMS[alg].import,
      false,
      ['verify']
    );
  } catch {
    throw new OidcError('unusable key in the issuer JWKS');
  }
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromBase64Url(parts[2]);
  } catch {
    throw new OidcError('malformed ID token');
  }
  const valid = await crypto.subtle.verify(
    ALGORITHMS[alg].verify,
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new OidcError('ID token signature does not verify');

  const claims = decodeJson<IdTokenClaims>(parts[1]);
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== expected.issuer) throw new OidcError('ID token issuer mismatch');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.clientId)) throw new OidcError('ID token audience mismatch');
  if (audiences.length > 1 && claims.azp !== expected.clientId) {
    throw new OidcError('ID token azp mismatch');
  }
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW <= now) {
    throw new OidcError('ID token expired');
  }
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW > now) {
    throw new OidcError('ID token issued in the future');
  }
  if (claims.nonce !== expected.nonce) throw new OidcError('ID token nonce mismatch');
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new OidcError('ID token has no subject');
  }
  return claims;
}

/** Random base64url string of `bytes` random bytes (state, nonce, PKCE verifier). */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge of a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export function authorizationUrl(
  metadata: ProviderMetadata,
  params: {
    clientId: string;
    redirectUri: string;
    state: string;
    nonce: string;
    challenge: string;
  }
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Trade the authorization code for tokens; returns the raw ID token. */
export async function exchangeCode(
  metadata: ProviderMetadata,
  params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    verifier: string;
  }
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.verifier,
  });
  const tokens = (await fetchJson(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })) as { id_token?: unknown };
  if (typeof tokens.id_token !== 'string') throw new OidcError('token response has no id_token');
  return tokens.id_token;
}

/** A display name from the usual claims. */
export function displayName(claims: IdTokenClaims): string {
  const name = claims.name || claims.preferred_username || claims.given_name || claims.email;
  return (name ?? 'Signed in').slice(0, 80);
}

export function isEmailVerified(claims: IdTokenClaims): boolean {
  return claims.email_verified === true || claims.email_verified === 'true';
}
