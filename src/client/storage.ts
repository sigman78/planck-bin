/**
 * Storage (Backend) - Pure Async I/O
 *
 * Responsibilities:
 * - All network I/O: load, save, create, delete
 * - Returns plain data objects
 * - No state, no DOM access
 * - Throws errors on failure
 */

import type {
  BurnPending,
  GetResponse,
  LifetimeId,
  LockSpec,
  LockedPending,
  OwnedList,
  SaveResponse,
  UnlockRejected,
} from '../shared/types';
import { isLockedPending, takeEmbeddedDocument } from './embedded-document';
import type { BurnState } from './paste';

export interface LoadResult {
  content: string;
  key: string;
  frozen?: boolean;
  /** Burn after reading: 'armed' for the creator's copy, 'burned' once read. */
  burn?: BurnState;
  /** Protected paste (content here is the decrypted text). */
  locked?: boolean;
  /** The signed-in viewer created it. */
  mine?: boolean;
  /** Readable by its owner only. */
  private?: boolean;
}

export interface SaveOptions {
  /** Omitted = the server default. */
  expires?: LifetimeId;
  burn?: boolean;
  /** Protected paste: the content is already encrypted. */
  lock?: LockSpec;
  /** Readable by the signed-in creator only. */
  private?: boolean;
  /** Saved while signed in: the paste is owned. */
  owned?: boolean;
}

export interface SaveResult {
  key: string;
  burn?: BurnState;
  private?: boolean;
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

/**
 * Thrown by load() for a protected paste: the caller asks for the passphrase
 * and unlocks it with the salt.
 */
export class LockedError extends Error {
  readonly key: string;
  readonly salt: string;
  readonly burn: boolean;
  readonly mine: boolean;

  constructor(pending: LockedPending) {
    super('Protected paste');
    this.name = 'LockedError';
    this.key = pending.key;
    this.salt = pending.salt;
    this.burn = pending.burn === true;
    this.mine = pending.mine === true;
  }
}

/** Thrown by unlock() for a wrong passphrase; `attemptsLeft` 0 = the paste is deleted. */
export class UnlockRejectedError extends Error {
  constructor(readonly attemptsLeft: number) {
    super(attemptsLeft > 0 ? 'Wrong passphrase' : 'Too many wrong passphrases');
    this.name = 'UnlockRejectedError';
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
  remember(doc: LoadResult): void {
    this.recent.delete(doc.key);
    this.recent.set(doc.key, doc);
    if (this.recent.size > RECENT_LIMIT) {
      this.recent.delete(this.recent.keys().next().value!);
    }
  }

  /** Drop the memory copies (sign-in changes what `mine` and private pastes say). */
  forgetAll(): void {
    this.recent.clear();
  }

  /**
   * Load document from server
   * @throws Error if fetch fails or document not found
   * @throws BurnPendingError for an unread burn paste, unless `reveal` is set
   * @throws LockedError for a protected paste (see unlock)
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
    if (isLockedPending(data)) throw new LockedError(data);
    if ('burnPending' in data) throw new BurnPendingError(key);
    const doc: LoadResult = {
      content: data.content,
      key: data.key,
      frozen: data.frozen,
      burn: data.burn ? 'burned' : undefined,
      mine: data.mine === true,
      private: data.private === true,
    };
    // A revealed burn paste exists only in this tab now: back/forward finds it here.
    this.remember(doc);
    return doc;
  }

  /**
   * Without `reveal`, ?peek=1 makes the server answer a burn paste with a
   * marker instead of reading (and destroying) it.
   */
  private async fetchDocument(
    key: string,
    reveal: boolean
  ): Promise<GetResponse | BurnPending | LockedPending> {
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
   * Trade the unlock token for the protected paste's ciphertext. Not cached:
   * the caller remembers the decrypted text.
   * @throws UnlockRejectedError for a wrong token
   * @throws Error('Document not found') when it is gone
   */
  async unlock(key: string, token: string): Promise<GetResponse> {
    const response = await fetch(`/documents/${key}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (response.status === 403 || response.status === 410) {
      const data: UnlockRejected = await response.json();
      throw new UnlockRejectedError(data.attemptsLeft);
    }
    if (response.status === 404) throw new Error('Document not found');
    if (!response.ok) throw new Error(`Failed to unlock document: ${response.statusText}`);
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
    if (options.private) query.set('private', '1');
    const search = query.toString();
    // A lock rides in a JSON body: the token stays out of URLs and logs.
    const response = await fetch(search ? `/documents?${search}` : '/documents', {
      method: 'POST',
      headers: {
        'Content-Type': options.lock ? 'application/json' : 'text/plain',
      },
      body: options.lock ? JSON.stringify({ content, lock: options.lock }) : content,
    });

    if (!response.ok) {
      throw new Error(`Failed to save document: ${response.statusText}`);
    }

    const data: SaveResponse = await response.json();

    // The creator sees a burn paste from memory: no read, so it stays armed.
    const burn = data.burn ? 'armed' : undefined;
    const owned = { mine: options.owned === true, private: data.private === true };
    // A protected paste is remembered by the caller, as text rather than ciphertext.
    if (!options.lock) this.remember({ key: data.key, content, burn, ...owned });
    return { key: data.key, burn, private: owned.private };
  }

  /**
   * The signed-in user's pastes, newest first.
   * @throws Error when signed out or the server could not answer
   */
  async listMine(before?: string): Promise<OwnedList> {
    const response = await fetch(
      before ? `/documents?before=${encodeURIComponent(before)}` : '/documents',
      { cache: 'no-store' }
    );
    if (!response.ok) throw new Error(`Failed to list pastes: ${response.status}`);
    return response.json();
  }

  /**
   * Delete one of the signed-in user's pastes.
   * @throws Error('Document not found') when it is gone or not theirs
   */
  async remove(key: string): Promise<void> {
    const response = await fetch(`/documents/${key}`, { method: 'DELETE' });
    if (response.status === 404) throw new Error('Document not found');
    if (!response.ok) throw new Error(`Failed to delete document: ${response.status}`);
    this.recent.delete(key);
  }
}
