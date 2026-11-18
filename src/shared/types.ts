/**
 * Shared API contract between the worker and the client.
 * Worker-only types (bindings, storage) live in src/worker/types.ts.
 *
 * The language is not part of the contract: it lives in the URL extension
 * (/key.cpp), which the client resolves and highlights.
 */

export interface SaveResponse {
  key: string;
}

export interface GetResponse {
  content: string;
  key: string;
  /** Built-in read-only page (e.g. about): not recorded in recents, no duplicate/raw. */
  frozen?: boolean;
  /** ISO 8601 timestamps; null for built-in pages and documents that never expire. */
  createdAt?: string | null;
  expiresAt?: string | null;
}

/**
 * Element id of the first document the worker embeds into the page it renders
 * (a <script type="application/json"> holding an EmbeddedPayload), so the
 * client can skip the initial /documents fetch.
 */
export const EMBEDDED_DOCUMENT_ID = 'embedded-document';

/** Embedded instead of a document when the worker confirmed the key does not exist. */
export interface EmbeddedNotFound {
  key: string;
  notFound: true;
}

export type EmbeddedPayload = GetResponse | EmbeddedNotFound;
