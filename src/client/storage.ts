/**
 * Storage (Backend) - Pure Async I/O
 *
 * Responsibilities:
 * - All network I/O: load, save, create, delete
 * - Returns plain data objects
 * - No state, no DOM access
 * - Throws errors on failure
 */

import type { GetResponse, SaveResponse } from '../shared/types';

export interface LoadResult {
  content: string;
  key: string;
  language?: string;
  frozen?: boolean;
}

export interface SaveResult {
  key: string;
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
   * @returns LoadedDocumentState with guaranteed key
   */
  async load(key: string): Promise<LoadResult> {
    const cached = this.recent.get(key);
    if (cached) {
      this.remember(cached); // refresh its position
      return cached;
    }

    const response = await fetch(`/documents/${key}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Document not found');
      }
      throw new Error(`Failed to load document: ${response.statusText}`);
    }

    const data: GetResponse = await response.json();

    const doc: LoadResult = {
      content: data.content,
      key: data.key,
      language: data.language,
      frozen: data.frozen,
    };
    this.remember(doc);
    return doc;
  }

  /**
   * Save document to server
   * @throws Error if save fails
   * @returns SaveResult with guaranteed key
   */
  async save(content: string): Promise<SaveResult> {
    const response = await fetch('/documents', {
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

    this.remember({ key: data.key, content });
    return {
      key: data.key,
    };
  }
}
