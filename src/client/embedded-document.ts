/**
 * The first document, when the worker rendered the page (SERVER_RENDER):
 * a GetResponse in <script type="application/json" id="embedded-document">.
 *
 * Read once and consumed by the first load of the matching key; any later
 * navigation fetches /documents as usual. Without the element (plain shell,
 * vite dev) everything behaves as before.
 */

import { EMBEDDED_DOCUMENT_ID, type GetResponse } from '../shared/types';

let embedded: GetResponse | null | undefined;

function read(): GetResponse | null {
  if (embedded !== undefined) return embedded;
  embedded = null;

  const el = document.getElementById(EMBEDDED_DOCUMENT_ID);
  if (!el) return null;
  el.remove(); // the content can be large; drop it from the DOM once parsed

  try {
    const data: unknown = JSON.parse(el.textContent ?? '');
    if (
      data &&
      typeof data === 'object' &&
      typeof (data as GetResponse).key === 'string' &&
      typeof (data as GetResponse).content === 'string'
    ) {
      embedded = data as GetResponse;
    }
  } catch (err) {
    console.error('Ignoring malformed embedded document:', err);
  }
  return embedded;
}

/** Whether the page carries the document for `key` (not yet consumed). */
export function hasEmbeddedDocument(key: string): boolean {
  return read()?.key === key;
}

/** The embedded document for `key`, once; null afterwards or for another key. */
export function takeEmbeddedDocument(key: string): GetResponse | null {
  const doc = read();
  embedded = null;
  return doc?.key === key ? doc : null;
}
