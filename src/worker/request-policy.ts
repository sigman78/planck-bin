import type { Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getServerConfig } from './config';
import { isJsonContentType } from './http';
import type { Env } from './types';
import { SECURITY_HEADERS } from '../shared/security-headers';

type App = { Bindings: Env };

const JSON_ENCODING_EXPANSION = 6;
const JSON_ENVELOPE_BYTES = 1024;

const addSecurityHeaders: MiddlewareHandler<App> = async (c, next) => {
  await next();

  // Responses returned by fetch bindings (including ASSETS) can have immutable
  // headers. Clone once at the boundary before applying the global policy.
  const response = new Response(c.res.body, c.res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  c.res = response;
};

function isDocumentWrite(path: string, method: string): boolean {
  return method === 'POST' && path === '/documents';
}

/** An unlock is a read (and a passphrase guess): it spends a read token too. */
function isDocumentUnlock(path: string, method: string): boolean {
  return method === 'POST' && /^\/documents\/[^/]+\/unlock$/.test(path);
}

/** The unlock body is a small JSON object holding one token. */
const UNLOCK_BODY_LIMIT = 1024;

/** HEAD runs the GET handler (and its D1 read), so it is limited like GET. */
function isDocumentRead(path: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  // /documents alone is the signed-in user's list.
  return path === '/documents' || /^\/(?:documents|raw)\/[^/]+$/.test(path);
}

/** Deleting an own paste: a browser write like creation. */
function isDocumentDelete(path: string, method: string): boolean {
  return method === 'DELETE' && /^\/documents\/[^/]+$/.test(path);
}

/** Sign-in steps that make outbound requests to the identity provider. */
function isSignInStep(path: string, method: string): boolean {
  return method === 'GET' && (path === '/auth/login' || path === '/auth/callback');
}

function isSignOut(path: string, method: string): boolean {
  return method === 'POST' && path === '/auth/logout';
}

function isCrossOriginBrowserWrite(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;

  const origin = request.headers.get('origin');
  if (!origin) return false; // Non-browser clients such as curl do not send Origin.

  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

function rateLimitKey(request: Request): string {
  // Sign-in is optional and the API stays anonymous, so the connecting IP is
  // the least-bad coarse identity available. Keep configured limits NAT-friendly.
  return request.headers.get('cf-connecting-ip') || 'unknown-client';
}

async function checkRateLimit(c: Parameters<MiddlewareHandler<App>>[0], limiter: RateLimit) {
  try {
    const { success } = await limiter.limit({ key: rateLimitKey(c.req.raw) });
    if (success) return null;

    c.header('Retry-After', '60');
    return c.json({ message: 'Too many requests' }, 429);
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return c.json({ message: 'Request policy unavailable' }, 503);
  }
}

const enforceRequestPolicy: MiddlewareHandler<App> = async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;

  if (isDocumentWrite(path, method)) {
    if (isCrossOriginBrowserWrite(c.req.raw)) {
      return c.json({ message: 'Cross-origin document creation is not allowed' }, 403);
    }

    const limited = await checkRateLimit(c, c.env.CREATE_RATE_LIMITER);
    if (limited) return limited;

    // JSON string escaping can expand one decoded content byte to six request
    // bytes (for example, "\u0000"). The route enforces the exact decoded byte
    // limit after parsing; this guard prevents unbounded buffering beforehand.
    const maxPasteSize = getServerConfig(c.env).maxPasteSize;
    const isJson = isJsonContentType(c.req.header('content-type'));
    return bodyLimit({
      maxSize: isJson ? maxPasteSize * JSON_ENCODING_EXPANSION + JSON_ENVELOPE_BYTES : maxPasteSize,
      onError: (context) => context.json({ message: 'Request body is too large' }, 413),
    })(c, next);
  }

  if (isDocumentRead(path, method)) {
    const limited = await checkRateLimit(c, c.env.READ_RATE_LIMITER);
    if (limited) return limited;
  }

  // Session-authorized writes: SameSite=Lax keeps the cookie off cross-site
  // requests, and this also turns away same-site sibling origins.
  if (isDocumentDelete(path, method) || isSignOut(path, method)) {
    if (isCrossOriginBrowserWrite(c.req.raw)) {
      return c.json({ message: 'Cross-origin request is not allowed' }, 403);
    }
    if (isDocumentDelete(path, method)) {
      const limited = await checkRateLimit(c, c.env.CREATE_RATE_LIMITER);
      if (limited) return limited;
    }
  }

  if (isSignInStep(path, method)) {
    const limited = await checkRateLimit(c, c.env.CREATE_RATE_LIMITER);
    if (limited) return limited;
  }

  if (isDocumentUnlock(path, method)) {
    const limited = await checkRateLimit(c, c.env.READ_RATE_LIMITER);
    if (limited) return limited;
    return bodyLimit({
      maxSize: UNLOCK_BODY_LIMIT,
      onError: (context) => context.json({ message: 'Request body is too large' }, 413),
    })(c, next);
  }

  await next();
};

/**
 * Read-limit check for routes outside /documents and /raw that still read a
 * document (the server-rendered paste page). False when limited or when the
 * limiter fails; the caller then falls back to the plain page.
 */
export async function isReadAllowed(c: Parameters<MiddlewareHandler<App>>[0]): Promise<boolean> {
  try {
    const { success } = await c.env.READ_RATE_LIMITER.limit({ key: rateLimitKey(c.req.raw) });
    return success;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return false;
  }
}

/** Install the complete HTTP boundary policy in one place. */
export function installRequestPolicy(app: Hono<App>): void {
  // Register security headers first so they are also applied to policy errors.
  app.use('*', addSecurityHeaders);
  app.use('*', enforceRequestPolicy);
}
