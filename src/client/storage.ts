/**
 * Storage (Backend) - Pure Async I/O
 *
 * Responsibilities:
 * - All network I/O: load, save, create, delete
 * - Returns plain data objects
 * - No state, no DOM access
 * - Throws errors on failure
 */

import type { BurnPending, GetResponse, LifetimeId, SaveResponse } from '../shared/types';
import { takeEmbeddedDocument } from './embedded-document';
import type { BurnState } from './paste';

export interface LoadResult {
  content: string;
  key: string;
  frozen?: boolean;
  /** Burn after reading: 'armed' for the creator's copy, 'burned' once read. */
  burn?: BurnState;
}

export interface SaveOptions {
  /** Omitted = the server default. */
  expires?: LifetimeId;
  burn?: boolean;
}

export interface SaveResult {
  key: string;
  burn?: BurnState;
}

/**
 * Thrown by load() for an unread burn-after-reading paste: reading it would
 * destroy it, so the caller asks first and then loads with `reveal`.
 */
export class BurnPendingError extends Error {
  constructor(readonly key: string) {
    super('Burn after reading');
    this.name = 'BurnPendingError';
  }
}

/** Recently loaded or saved pastes kept in memory (pastes never change). */
const RECENT_LIMIT = 16;

export class StorageService {
  private recent = new Map<string, LoadResult>();

  /**
   * Back/forward to a paste seen in this tab renders from memory: the load
   * then resolves in microtasks, before the next frame, so the page matches
   * the browser's snapshot when a swipe gesture hands over to it.
   */
  private remember(doc: LoadResult): void {
    this.recent.delete(doc.key);
    this.recent.set(doc.key, doc);
    if (this.recent.size > RECENT_LIMIT) {
      this.recent.delete(this.recent.keys().next().value!);
    }
  }

  /**
   * Load document from server
   * @throws Error if fetch fails or document not found
   * @throws BurnPendingError for an unread burn paste, unless `reveal` is set
   * @returns LoadedDocumentState with guaranteed key
   */
  async load(key: string, reveal = false): Promise<LoadResult> {
    const cached = this.recent.get(key);
    if (cached) {
      this.remember(cached); // refresh its position
      return cached;
    }

    // A server-rendered page already carries its document, or says it is gone.
    const embedded = takeEmbeddedDocument(key);
    if (embedded === 'not-found') throw new Error('Document not found');
    if (embedded === 'burn-pending' && !reveal) throw new BurnPendingError(key);
    const data =
      embedded && embedded !== 'burn-pending' ? embedded : await this.fetchDocument(key, reveal);
    if ('burnPending' in data) throw new BurnPendingError(key);
    const doc: LoadResult = {
      content: data.content,
      key: data.key,
      frozen: data.frozen,
      burn: data.burn ? 'burned' : undefined,
    };
    // A revealed burn paste exists only in this tab now: back/forward finds it here.
    this.remember(doc);
    return doc;
  }

  /**
   * Without `reveal`, ?peek=1 makes the server answer a burn paste with a
   * marker instead of reading (and destroying) it.
   */
  private async fetchDocument(key: string, reveal: boolean): Promise<GetResponse | BurnPending> {
    const response = await fetch(reveal ? `/documents/${key}` : `/documents/${key}?peek=1`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Document not found');
      }
      throw new Error(`Failed to load document: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Save document to server
   * @throws Error if save fails
   * @returns SaveResult with guaranteed key
   */
  async save(content: string, options: SaveOptions = {}): Promise<SaveResult> {
    const query = new URLSearchParams();
    if (options.expires) query.set('expires', options.expires);
    if (options.burn) query.set('burn', '1');
    const search = query.toString();
    const response = await fetch(search ? `/documents?${search}` : '/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: content,
    });

    if (!response.ok) {
      throw new Error(`Failed to save document: ${response.statusText}`);
    }

    const data: SaveResponse = await response.json();

    // The creator sees a burn paste from memory: no read, so it stays armed.
    const burn = data.burn ? 'armed' : undefined;
    this.remember({ key: data.key, content, burn });
    return { key: data.key, burn };
  }
}
