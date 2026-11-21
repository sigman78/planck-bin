import { StorageService, type SaveOptions } from './storage';
import type { BurnState } from './paste';
import { highlightContent, getExtensionForLanguage, resolveLanguage } from './highlight-config';
import { buildPath, type ParsedPath } from './path-utils';

export interface DocumentRenderResult {
  paste: {
    content: string;
    key: string;
    language?: string;
    frozen?: boolean;
    burn?: BurnState;
  };
  highlighted?: string;
  canonicalPath: string;
}

export class DocumentSession {
  constructor(private readonly storage: StorageService = new StorageService()) {}

  async save(content: string, options?: SaveOptions): Promise<DocumentRenderResult> {
    const result = await this.storage.save(content, options);
    const highlightResult = highlightContent(content);
    const language = highlightResult.language;
    const ext = language ? getExtensionForLanguage(language) : undefined;

    return {
      paste: {
        content,
        key: result.key,
        language,
        burn: result.burn,
      },
      highlighted: highlightResult.highlighted,
      canonicalPath: buildPath(result.key, ext),
    };
  }

  /** @throws BurnPendingError for an unread burn paste, unless `reveal` is set */
  async load(path: ParsedPath, reveal = false): Promise<DocumentRenderResult> {
    const urlLanguage = path.ext ? resolveLanguage(path.ext) : undefined;
    const result = await this.storage.load(path.key, reveal);
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
