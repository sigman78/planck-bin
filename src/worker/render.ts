/**
 * Server render of a paste page: the built index.html shell with the paste
 * filled in, so the first paint shows the text and the client needs no
 * /documents fetch.
 *
 * - The text is escaped into the viewer <pre> for first paint only. The HTML
 *   parser normalizes CR/CRLF there, so the client never reads content back
 *   from the DOM.
 * - The authoritative copy is a GetResponse in a <script type="application/json">
 *   (data, never executed, so the CSP's script-src does not apply).
 * - No highlighting here: the language comes from the URL extension and the
 *   client highlights on load.
 *
 * Pure string work (no HTMLRewriter) so it runs and is tested under node.
 * Every anchor must occur exactly once; otherwise this returns null and the
 * caller serves the plain shell, which is the old client-rendered path.
 */

import {
  EMBEDDED_DOCUMENT_ID,
  type EmbeddedPayload,
  type GetResponse,
  type LockedPending,
} from '../shared/types';

/** The empty viewer as it appears in the built shell (src/client/index.html). */
const VIEWER_A11Y = 'tabindex="0" role="region" aria-label="Paste content"';
export const VIEWER_ANCHOR = `<pre id="viewer" style="display: none" ${VIEWER_A11Y}><code class="hljs"></code></pre>`;
const TITLE_OPEN = '<title>';
const TITLE_CLOSE = '</title>';
const BODY_CLOSE = '</body>';

export interface RenderInput {
  appName: string;
  /** The requested name, e.g. "abc.cpp", for the preview title. */
  displayName: string;
  doc: GetResponse;
}

export function renderDocumentPage(shell: string, input: RenderInput): string | null {
  const { appName, displayName, doc } = input;

  const titleStart = singleIndex(shell, TITLE_OPEN);
  const titleEnd = singleIndex(shell, TITLE_CLOSE);
  if (titleStart === null || titleEnd === null || titleEnd < titleStart) return null;

  const title =
    `${TITLE_OPEN}${escapeText(`${appName} - ${doc.key}`)}${TITLE_CLOSE}` +
    `<meta property="og:title" content="${escapeAttribute(displayName)}" />`;
  let html = shell.slice(0, titleStart) + title + shell.slice(titleEnd + TITLE_CLOSE.length);

  const viewer =
    `<pre id="viewer" style="display: block" ${VIEWER_A11Y}><code class="hljs">` +
    escapeText(doc.content) +
    '</code></pre>';
  const withViewer = replaceOnce(html, VIEWER_ANCHOR, viewer);
  if (withViewer === null) return null;
  html = withViewer;

  return embed(html, doc);
}

/**
 * The shell for a key the worker looked up and did not find: unchanged except
 * for a not-found marker, so the client shows "not found" without a second
 * lookup. Served with status 404.
 */
export function renderNotFoundPage(shell: string, key: string): string | null {
  return embed(shell, { key, notFound: true });
}

/**
 * The shell for an unread burn-after-reading paste: no content and no preview
 * tags, only a marker, so the client asks before reading (and destroying) it.
 * Link unfurlers and prefetchers that load the page consume nothing.
 */
export function renderBurnPage(shell: string, key: string): string | null {
  return embed(shell, { key, burnPending: true });
}

/** A protected paste: the client asks for the passphrase (no content in the page). */
export function renderLockedPage(shell: string, payload: LockedPending): string | null {
  return embed(shell, payload);
}

/** Insert the payload as inert JSON just before </body>. */
function embed(html: string, payload: EmbeddedPayload): string | null {
  const data =
    `<script type="application/json" id="${EMBEDDED_DOCUMENT_ID}">` +
    serializeJsonForScript(payload) +
    `</script>${BODY_CLOSE}`;
  return replaceOnce(html, BODY_CLOSE, data);
}

/** Index of the only occurrence of `needle`, or null when absent or repeated. */
function singleIndex(haystack: string, needle: string): number | null {
  const first = haystack.indexOf(needle);
  if (first === -1 || haystack.indexOf(needle, first + 1) !== -1) return null;
  return first;
}

/** Replace the single occurrence of `anchor` (by slicing, so `$&` and friends stay literal). */
function replaceOnce(haystack: string, anchor: string, replacement: string): string | null {
  const at = singleIndex(haystack, anchor);
  if (at === null) return null;
  return haystack.slice(0, at) + replacement + haystack.slice(at + anchor.length);
}

// Native replaceAll with constant strings (no `$` patterns in the replacements):
// a per-character callback costs about 10x more on markup-heavy pastes, which
// matters within the free plan's CPU budget.
export function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * JSON safe inside <script>: escaping < (and >, &, U+2028/9) as \uXXXX keeps
 * "</script>" and "<!--" in the content from ending or altering the element.
 */
export function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', jsonEscape('<'))
    .replaceAll('>', jsonEscape('>'))
    .replaceAll('&', jsonEscape('&'))
    .replaceAll(LINE_SEPARATOR, jsonEscape(LINE_SEPARATOR))
    .replaceAll(PARAGRAPH_SEPARATOR, jsonEscape(PARAGRAPH_SEPARATOR));
}

/** The JSON \uXXXX escape for one character. */
function jsonEscape(ch: string): string {
  return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
}
