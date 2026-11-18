/**
 * The first document, when the worker rendered the page (SERVER_RENDER):
 * an EmbeddedPayload in <script type="application/json" id="embedded-document">,
 * either the GetResponse or a not-found marker for a key that does not exist.
 *
 * Read once and consumed by the first load of the matching key; any later
 * navigation fetches /documents as usual. Without the element (plain shell,
 * vite dev) everything behaves as before.
 */

import { EMBEDDED_DOCUMENT_ID, type EmbeddedPayload, type GetResponse } from '../shared/types';

let embedded: EmbeddedPayload | null | undefined;

function isPayload(data: unknown): data is EmbeddedPayload {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<GetResponse> & { notFound?: unknown };
  if (typeof d.key !== 'string') return false;
  return d.notFound === true || typeof d.content === 'string';
}

function isNotFound(payload: EmbeddedPayload): payload is { key: string; notFound: true } {
  return 'notFound' in payload && payload.notFound === true;
}

function read(): EmbeddedPayload | null {
  if (embedded !== undefined) return embedded;
  embedded = null;

  const el = document.getElementById(EMBEDDED_DOCUMENT_ID);
  if (!el) return null;
  el.remove(); // the content can be large; drop it from the DOM once parsed

  try {
    const data: unknown = JSON.parse(el.textContent ?? '');
    if (isPayload(data)) embedded = data;
  } catch (err) {
    console.error('Ignoring malformed embedded document:', err);
  }
  return embedded;
}

/** Whether the page carries the document for `key` (not yet consumed). */
export function hasEmbeddedDocument(key: string): boolean {
  const payload = read();
  return payload?.key === key && !isNotFound(payload);
}

/**
 * The embedded document for `key`, once: the document, 'not-found' when the
 * worker confirmed the key does not exist, or null (nothing embedded for this
 * key, or already consumed).
 */
export function takeEmbeddedDocument(key: string): GetResponse | 'not-found' | null {
  const payload = read();
  embedded = null;
  if (payload?.key !== key) return null;
  return isNotFound(payload) ? 'not-found' : payload;
}
