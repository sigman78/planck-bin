/** @jest-environment node */

import { fakeEnv } from '../__fakes__/env';
import {
  AUTH_VARS,
  CLIENT_ID,
  CLIENT_SECRET,
  ISSUER,
  claimsFor,
  installFakeIdp,
  makeKey,
  signJwt,
  type FakeIdp,
} from '../__fakes__/idp';
import { ORIGIN, requester, signIn, startSignIn, testApp } from '../__fakes__/sign-in';
import { safeReturnPath } from '../auth';
import { pkceChallenge } from '../oidc';
import type { Env } from '../types';
import type { AuthState } from '../../shared/types';
import { toBase64Url } from '../../shared/base64url';

const app = testApp();
let idp: FakeIdp & { nonce: string };

beforeEach(async () => {
  idp = await installFakeIdp();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  idp.restore();
  jest.restoreAllMocks();
});

function setup(vars: Partial<Env> = AUTH_VARS) {
  const fake = fakeEnv({ vars });
  return { ...fake, request: requester(app, fake.env, fake.ctx) };
}

const me = async (request: ReturnType<typeof setup>['request']) =>
  (await (await request('/auth/me')).json()) as AuthState;

/** The flash value a failed sign-in left, and where it went. */
function failure(res: Response) {
  const flash = res.headers
    .getSetCookie()
    .find((c) => c.startsWith('pb_flash='))
    ?.split(';')[0]
    .slice('pb_flash='.length);
  return { status: res.status, location: res.headers.get('location'), flash };
}

describe('sign-in off (unconfigured)', () => {
  it('reports disabled and has no login routes', async () => {
    const { request } = setup({});
    expect(await me(request)).toEqual({ enabled: false, user: null });
    expect((await request('/auth/login')).status).toBe(404);
    expect((await request('/auth/callback?code=x&state=y')).status).toBe(404);
  });

  it('stays off with a partial or weak setup', async () => {
    expect(await me(setup({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID }).request)).toEqual({
      enabled: false,
      user: null,
    });
    expect(await me(setup({ ...AUTH_VARS, SESSION_SECRET: 'short' }).request)).toMatchObject({
      enabled: false,
    });
  });
});

describe('sign-in flow', () => {
  it('redirects to the provider with PKCE, state and nonce in a sealed cookie', async () => {
    const { request } = setup();
    const { res, location, params } = await startSignIn(request, '/abc.js#L3');
    expect(res.status).toBe(302);
    expect(location.startsWith(`${ISSUER}/authorize?`)).toBe(true);
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid profile email');
    expect(params.get('code_challenge_method')).toBe('S256');
    for (const name of ['state', 'nonce', 'code_challenge'])
      expect(params.get(name)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const tx = res.headers.getSetCookie().find((c) => c.startsWith('__Host-pb_tx='))!;
    expect(tx).toMatch(/HttpOnly/);
    expect(tx).toMatch(/Secure/);
    expect(tx).toMatch(/SameSite=Lax/);
    expect(tx).toMatch(/Path=\//);
  });

  it('signs in, comes back to the return path, and signs out', async () => {
    const { request } = setup();
    const { params } = await startSignIn(request, '/abc.js#L3');
    idp.nonce = params.get('nonce')!;
    const res = await request(`/auth/callback?code=the-code&state=${params.get('state')}`);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/abc.js#L3');
    const session = res.headers.getSetCookie().find((c) => c.startsWith('__Host-pb_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Max-Age=2592000/);
    // The readable hint, and the transaction cookie spent.
    expect(request.jar.cookies.get('pb_in')).toBe('1');
    expect(request.jar.cookies.has('__Host-pb_tx')).toBe(false);

    // The code exchange proved the PKCE verifier and the client secret.
    const sent = idp.lastTokenRequest!;
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('the-code');
    // No methods in discovery: client_secret_basic, the spec default.
    expect(sent.get('client_secret')).toBeNull();
    expect(idp.lastTokenAuth).toBe(`Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`);
    expect(await pkceChallenge(sent.get('code_verifier')!)).toBe(params.get('code_challenge'));

    expect(await me(request)).toEqual({ enabled: true, user: { name: 'Ada Lovelace' } });

    const out = await request('/auth/logout', { method: 'POST', headers: { Origin: ORIGIN } });
    expect(out.status).toBe(204);
    expect(request.jar.cookies.has('__Host-pb_session')).toBe(false);
    expect(request.jar.cookies.has('pb_in')).toBe(false);
    expect(await me(request)).toEqual({ enabled: true, user: null });
  });

  it('accepts ES256 tokens', async () => {
    const ec = await makeKey('ES256', 'ec-1');
    idp.keys = [ec];
    idp.tokenFor = (nonce) => signJwt(ec, claimsFor(nonce));
    const { request } = setup();
    expect((await signIn(request, idp)).status).toBe(303);
    expect((await me(request)).user).toEqual({ name: 'Ada Lovelace' });
  });

  it('refetches the key set once for an unknown kid (rotation)', async () => {
    const { request } = setup();
    await signIn(request, idp);
    const rotated = await makeKey('RS256', 'rsa-2');
    idp.keys = [rotated];
    idp.tokenFor = (nonce) => signJwt(rotated, claimsFor(nonce));
    const jwksBefore = idp.calls.filter((c) => c.endsWith('/jwks')).length;

    const other = setup().request;
    await signIn(other, idp);
    expect((await me(other)).user).not.toBeNull();
    expect(idp.calls.filter((c) => c.endsWith('/jwks')).length).toBe(jwksBefore + 1);
  });
});

describe('sign-in failures', () => {
  it('rejects a state that does not match the transaction', async () => {
    const { request } = setup();
    const { params } = await startSignIn(request, '/x');
    idp.nonce = params.get('nonce')!;
    const res = await request('/auth/callback?code=c&state=forged');
    expect(failure(res)).toEqual({ status: 303, location: '/x', flash: 'signin-failed' });
    expect(request.jar.cookies.has('__Host-pb_session')).toBe(false);
  });

  it('rejects a callback without its transaction cookie', async () => {
    const { request } = setup();
    const res = await request('/auth/callback?code=c&state=s');
    expect(failure(res)).toMatchObject({ location: '/', flash: 'signin-failed' });
  });

  it('reports a denial at the provider', async () => {
    const { request } = setup();
    await startSignIn(request, '/x');
    const res = await request('/auth/callback?error=access_denied&state=s');
    expect(failure(res)).toMatchObject({ location: '/x', flash: 'denied' });
  });

  it('rejects an issuer named in the callback that is not ours', async () => {
    const { request } = setup();
    const { params } = await startSignIn(request);
    idp.nonce = params.get('nonce')!;
    const res = await request(
      `/auth/callback?code=c&state=${params.get('state')}&iss=https%3A%2F%2Fevil.test`
    );
    expect(failure(res).flash).toBe('signin-failed');
  });

  const badTokens: [string, (nonce: string) => Promise<string>][] = [
    ['wrong issuer', (n) => signJwt(idp.keys[0], claimsFor(n, { iss: 'https://evil.test' }))],
    ['wrong audience', (n) => signJwt(idp.keys[0], claimsFor(n, { aud: 'someone-else' }))],
    [
      'several audiences without azp',
      (n) => signJwt(idp.keys[0], claimsFor(n, { aud: [CLIENT_ID, 'other'] })),
    ],
    ['wrong nonce', () => signJwt(idp.keys[0], claimsFor('another-nonce'))],
    [
      'expired',
      (n) =>
        signJwt(idp.keys[0], claimsFor(n, { exp: Math.floor(Date.now() / 1000) - 120, iat: 1 })),
    ],
    [
      'issued in the future',
      (n) => signJwt(idp.keys[0], claimsFor(n, { iat: Math.floor(Date.now() / 1000) + 600 })),
    ],
    [
      'alg none',
      async (n) => {
        const enc = (v: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(v)));
        return `${enc({ alg: 'none', kid: 'rsa-1' })}.${enc(claimsFor(n))}.`;
      },
    ],
    [
      'tampered payload',
      async (n) => {
        const [h, , s] = (await signJwt(idp.keys[0], claimsFor(n))).split('.');
        const forged = toBase64Url(
          new TextEncoder().encode(JSON.stringify(claimsFor(n, { sub: 'admin' })))
        );
        return `${h}.${forged}.${s}`;
      },
    ],
    [
      'HS256 keyed with the public key',
      async (n) => {
        const enc = (v: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(v)));
        const head = `${enc({ alg: 'HS256', kid: 'rsa-1' })}.${enc(claimsFor(n))}`;
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(JSON.stringify(idp.keys[0].publicJwk)),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(head));
        return `${head}.${toBase64Url(new Uint8Array(sig))}`;
      },
    ],
  ];

  it.each(badTokens)('rejects an ID token: %s', async (_name, token) => {
    idp.tokenFor = token;
    const { request } = setup();
    const res = await signIn(request, idp, '/x');
    expect(failure(res)).toEqual({ status: 303, location: '/x', flash: 'signin-failed' });
    expect((await me(request)).user).toBeNull();
  });

  it('reports an unreachable provider', async () => {
    idp.down = true;
    const { request } = setup();
    const res = await request('/auth/login?return=/x');
    expect(failure(res)).toEqual({ status: 303, location: '/x', flash: 'unavailable' });
  });

  it('turns away a cross-origin sign-out', async () => {
    const { request } = setup();
    await signIn(request, idp);
    const res = await request('/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.test' },
    });
    expect(res.status).toBe(403);
    expect((await me(request)).user).not.toBeNull();
  });
});

describe('token endpoint client authentication', () => {
  it('posts the secret in the body when the provider lists only client_secret_post', async () => {
    idp.authMethods = ['client_secret_post'];
    const { request } = setup();
    expect((await signIn(request, idp)).status).toBe(303);
    expect(idp.lastTokenRequest!.get('client_secret')).toBe(CLIENT_SECRET);
    expect(idp.lastTokenAuth).toBeNull();
  });

  it('prefers Basic when both are listed', async () => {
    idp.authMethods = ['client_secret_post', 'client_secret_basic'];
    expect((await signIn(setup().request, idp)).status).toBe(303);
    expect(idp.lastTokenAuth).toMatch(/^Basic /);
  });
});

describe('allowlist (OIDC_ALLOWED_EMAILS)', () => {
  const vars = { ...AUTH_VARS, OIDC_ALLOWED_EMAILS: 'Ada@Example.test, bob@example.test' };

  it('lets a listed, verified email in (case-insensitive)', async () => {
    const { request } = setup(vars);
    expect((await signIn(request, idp)).status).toBe(303);
    expect((await me(request)).user).not.toBeNull();
  });

  it('denies an email that is not listed, or not verified', async () => {
    idp.tokenFor = (n) => signJwt(idp.keys[0], claimsFor(n, { email: 'eve@example.test' }));
    expect(failure(await signIn(setup(vars).request, idp)).flash).toBe('denied');

    idp.tokenFor = (n) => signJwt(idp.keys[0], claimsFor(n, { email_verified: false }));
    expect(failure(await signIn(setup(vars).request, idp)).flash).toBe('denied');
  });

  it('a value that names no address lets nobody in', async () => {
    const empty = { ...AUTH_VARS, OIDC_ALLOWED_EMAILS: ' , ' };
    expect(failure(await signIn(setup(empty).request, idp)).flash).toBe('denied');
  });

  it('a session with an unverified email does not pass a later allowlist', async () => {
    idp.tokenFor = (n) => signJwt(idp.keys[0], claimsFor(n, { email_verified: false }));
    const fake = fakeEnv({ vars: AUTH_VARS });
    const request = requester(app, fake.env, fake.ctx);
    await signIn(request, idp);
    expect((await me(request)).user).not.toBeNull();
    (fake.env as unknown as Record<string, string>).OIDC_ALLOWED_EMAILS = 'ada@example.test';
    expect((await me(request)).user).toBeNull();
  });

  it('ends existing sessions of an email taken off the list', async () => {
    const fake = fakeEnv({ vars });
    const request = requester(app, fake.env, fake.ctx);
    await signIn(request, idp);
    expect((await me(request)).user).not.toBeNull();
    (fake.env as unknown as Record<string, string>).OIDC_ALLOWED_EMAILS = 'bob@example.test';
    expect((await me(request)).user).toBeNull();
  });
});

describe('safeReturnPath', () => {
  it.each([
    ['/abc.js#L3', '/abc.js#L3'],
    ['/?x=1', '/?x=1'],
    ['//evil.test/x', '/'],
    ['/\\evil.test', '/'],
    ['https://evil.test/', '/'],
    ['evil', '/'],
    ['/a\nb', '/'],
    [undefined, '/'],
  ])('%s -> %s', (input, out) => {
    expect(safeReturnPath(input as string | undefined, ORIGIN)).toBe(out);
  });
});
