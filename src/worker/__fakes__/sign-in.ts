/**
 * Test helpers around the sign-in routes: a cookie jar, a test app with the
 * whole worker stack, and a full sign-in against the fake identity provider.
 */

import { Hono } from 'hono';
import { api } from '../api';
import { auth } from '../auth';
import { createPageHandler } from '../pages';
import { installRequestPolicy } from '../request-policy';
import type { Env } from '../types';
import type { FakeIdp } from './idp';

export const ORIGIN = 'https://bin.test';

export function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  installRequestPolicy(app);
  app.route('/', auth);
  app.route('/', api);
  app.get('*', createPageHandler({ appName: 'Planck Bin' }));
  return app;
}

/** name -> value, following Set-Cookie (Max-Age=0 deletes). */
export class CookieJar {
  readonly cookies = new Map<string, string>();

  take(res: Response): Response {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export type Requester = (path: string, init?: RequestInit) => Promise<Response>;

/** A requester bound to an app, env and jar: absolute https URLs, cookies kept. */
export function requester(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  ctx: ExecutionContext,
  jar = new CookieJar()
): Requester & { jar: CookieJar } {
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const cookie = jar.header();
    if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);
    const url = path.startsWith('http') ? path : `${ORIGIN}${path}`;
    return jar.take(await app.request(url, { ...init, headers }, env, ctx));
  };
  return Object.assign(send, { jar });
}

/** Start a sign-in: the provider URL and its query (state, nonce, challenge). */
export async function startSignIn(request: Requester, returnTo = '/') {
  const res = await request(`/auth/login?return=${encodeURIComponent(returnTo)}`);
  const location = res.headers.get('location') ?? '';
  return { res, location, params: new URL(location, ORIGIN).searchParams };
}

/** Run the whole sign-in; returns the callback response. */
export async function signIn(request: Requester, idp: FakeIdp & { nonce: string }, returnTo = '/') {
  const { params } = await startSignIn(request, returnTo);
  idp.nonce = params.get('nonce') ?? '';
  return request(`/auth/callback?code=the-code&state=${params.get('state')}`);
}
