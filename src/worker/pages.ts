/**
 * Page routes: everything that is not the API or a static asset gets the SPA
 * shell (index.html). Paste URLs (/key or /key.ext) are optionally rendered on
 * the worker (SERVER_RENDER); any failure falls back to the plain shell, which
 * is exactly the client-rendered path.
 */

import type { Context } from 'hono';
import type { Env } from './types';
import { getServerConfig } from './config';
import { countView, loadDocumentWithin, toGetResponse } from './documents';
import { renderBurnPage, renderDocumentPage, renderNotFoundPage } from './render';
import { BURN_PENDING } from './types';
import { isReadAllowed } from './request-policy';

type AppContext = Context<{ Bindings: Env }>;

/**
 * Larger pastes get the plain shell (the client fetches them as before).
 * Escaping is linear but costs about 8 ms for a 400 KB markup-heavy paste,
 * close to the free plan's 10 ms CPU limit; 128 KB keeps the worst case near 2.5 ms.
 */
export const MAX_RENDER_CHARS = 128 * 1024;

export interface PageOptions {
  appName: string;
}

export interface DocumentRoute {
  key: string;
  /** Last path segment as requested, e.g. "abc.cpp". */
  displayName: string;
}

/**
 * Split a pathname the way the client does (src/client/path-utils.ts): the key
 * is everything before the first dot. Only single-segment paths are paste routes.
 */
export function parseDocumentRoute(pathname: string): DocumentRoute | null {
  const raw = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  if (raw === '' || raw.includes('/')) return null;
  const dot = raw.indexOf('.');
  const key = dot === -1 ? raw : raw.slice(0, dot);
  if (key === '') return null;
  let displayName = raw;
  try {
    displayName = decodeURIComponent(raw);
  } catch {
    // keep the encoded form
  }
  return { key, displayName };
}

function wantsHtml(c: AppContext): boolean {
  return (c.req.header('accept') ?? '').toLowerCase().includes('text/html');
}

/** A clean GET of the shell (no conditional headers, so always a full 200). */
function fetchShell(c: AppContext): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  url.search = '';
  return c.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
}

export function createPageHandler(options: PageOptions) {
  return async (c: AppContext): Promise<Response> => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith('/assets/')) return c.env.ASSETS.fetch(c.req.raw);

    const shell = await fetchShell(c);
    const route = parseDocumentRoute(pathname);
    if (!route || !getServerConfig(c.env).serverRender || shell.status !== 200) return shell;
    // Only pages: subresource requests that miss a static file (e.g. the
    // favicon) would otherwise spend a rate-limit token and a D1 read.
    if (!wantsHtml(c)) return shell;

    const rendered = await renderRoute(c, shell, route, options);
    return rendered ?? shell;
  };
}

async function renderRoute(
  c: AppContext,
  shell: Response,
  route: DocumentRoute,
  options: PageOptions
): Promise<Response | null> {
  try {
    // Limit before validating the key on purpose: invalid-key probes also spend
    // tokens, which slows scrapers that enumerate paste URLs.
    if (!(await isReadAllowed(c))) return null;
    const doc = await loadDocumentWithin(c, route.key, MAX_RENDER_CHARS);
    // The page never reads a burn paste: the client shows a reveal prompt.
    if (doc === BURN_PENDING) {
      const html = renderBurnPage(await shell.clone().text(), route.key);
      if (html === null) return null;
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    // Too large (by D1's code-point count, or by the JS UTF-16 count, which can
    // be higher): the plain shell, and the client fetches the paste.
    if (doc === 'too-large' || (doc && doc.content.length > MAX_RENDER_CHARS)) return null;

    const shellHtml = await shell.clone().text();
    // A confirmed miss (rate limits and errors never get here): a 404 page the
    // client recognizes, instead of a 200 shell and a second lookup.
    const html = doc
      ? renderDocumentPage(shellHtml, {
          appName: options.appName,
          displayName: route.displayName,
          doc: toGetResponse(doc),
        })
      : renderNotFoundPage(shellHtml, route.key);
    if (html === null) {
      console.error('Server render: shell anchors not found; serving the plain shell');
      return null;
    }
    if (doc) countView(c, doc);

    // Fresh headers: the shell's ETag/Content-Length do not describe this body,
    // and the page references hashed assets, so it must not outlive a deploy.
    return new Response(html, {
      status: doc ? 200 : 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Server render failed; serving the plain shell:', error);
    return null;
  }
}
