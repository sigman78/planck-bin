import { StorageService, type LoadResult, type SaveOptions } from './storage';
import type { OwnedList } from '../shared/types';
import type { BurnState } from './paste';
import {
  highlightContent,
  getExtensionForLanguage,
  resolveLanguage,
  type Highlighted,
} from './highlight-config';
import { buildPath, type ParsedPath } from './path-utils';
import { lockContent, openLock } from './lock-crypto';

export interface DocumentRenderResult {
  paste: {
    content: string;
    key: string;
    language?: string;
    frozen?: boolean;
    burn?: BurnState;
    locked?: boolean;
    mine?: boolean;
    private?: boolean;
  };
  highlighted?: Highlighted;
  canonicalPath: string;
}

export interface SessionSaveOptions extends Omit<SaveOptions, 'lock'> {
  /** Protected paste: encrypt in the browser under this passphrase. */
  passphrase?: string;
}

export class DocumentSession {
  constructor(private readonly storage: StorageService = new StorageService()) {}

  async save(content: string, options: SessionSaveOptions = {}): Promise<DocumentRenderResult> {
    const { passphrase, ...rest } = options;
    let result;
    if (passphrase !== undefined) {
      const { envelope, lock } = await lockContent(content, passphrase);
      result = await this.storage.save(envelope, { ...rest, lock });
      this.storage.remember({
        key: result.key,
        content,
        burn: result.burn,
        locked: true,
        mine: rest.owned === true,
        private: result.private === true,
      });
    } else {
      result = await this.storage.save(content, rest);
    }
    const highlightResult = highlightContent(content);
    const language = highlightResult.language;
    const ext = language ? getExtensionForLanguage(language) : undefined;

    return {
      paste: {
        content,
        key: result.key,
        language,
        burn: result.burn,
        locked: passphrase !== undefined,
        mine: rest.owned === true,
        private: result.private === true,
      },
      highlighted: highlightResult.highlighted,
      canonicalPath: buildPath(result.key, ext),
    };
  }

  /**
   * @throws BurnPendingError for an unread burn paste, unless `reveal` is set
   * @throws LockedError for a protected paste (see unlock)
   */
  async load(path: ParsedPath, reveal = false): Promise<DocumentRenderResult> {
    return this.present(path, await this.storage.load(path.key, reveal));
  }

  /**
   * Open a protected paste with `passphrase`.
   * @throws UnlockRejectedError for a wrong passphrase
   * @throws Error('Document not found') when it is gone
   */
  async unlock(path: ParsedPath, salt: string, passphrase: string): Promise<DocumentRenderResult> {
    const { token, decrypt } = await openLock(passphrase, salt);
    const data = await this.storage.unlock(path.key, token);
    const doc: LoadResult = {
      key: data.key,
      content: await decrypt(data.content),
      burn: data.burn ? 'burned' : undefined,
      locked: true,
      mine: data.mine === true,
      private: data.private === true,
    };
    // Back/forward in this tab shows it again without asking (like a revealed burn paste).
    this.storage.remember(doc);
    return this.present(path, doc);
  }

  /** The signed-in user's pastes, newest first. */
  listMine(before?: string): Promise<OwnedList> {
    return this.storage.listMine(before);
  }

  /** Delete one of the signed-in user's pastes. */
  remove(key: string): Promise<void> {
    return this.storage.remove(key);
  }

  /** Forget the in-memory copies (after a sign-out). */
  forgetAll(): void {
    this.storage.forgetAll();
  }

  private present(path: ParsedPath, result: LoadResult): DocumentRenderResult {
    const urlLanguage = path.ext ? resolveLanguage(path.ext) : undefined;
    // The URL extension is the only language source; without one, auto-detect.
    const highlightResult = highlightContent(result.content, urlLanguage);
    const plain = urlLanguage === '';
    const language = plain ? undefined : highlightResult.language || urlLanguage;

    return {
      paste: {
        content: result.content,
        key: result.key,
        language,
        frozen: result.frozen,
        burn: result.burn,
        locked: result.locked,
        mine: result.mine,
        private: result.private,
      },
      highlighted: highlightResult.highlighted,
      canonicalPath: plain
        ? buildPath(result.key, 'txt')
        : language
          ? buildPath(result.key, getExtensionForLanguage(language))
          : buildPath(path.key),
    };
  }
}
