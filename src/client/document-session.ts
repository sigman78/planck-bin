import { StorageService } from './storage';
import { highlightContent, getExtensionForLanguage, resolveLanguage } from './highlight-config';
import { buildPath, type ParsedPath } from './path-utils';

export interface DocumentRenderResult {
  paste: {
    content: string;
    key: string;
    language?: string;
    frozen?: boolean;
  };
  highlighted?: string;
  canonicalPath: string;
}

export class DocumentSession {
  constructor(private readonly storage: StorageService = new StorageService()) {}

  async save(content: string): Promise<DocumentRenderResult> {
    const result = await this.storage.save(content);
    const highlightResult = highlightContent(content);
    const language = highlightResult.language;
    const ext = language ? getExtensionForLanguage(language) : undefined;

    return {
      paste: {
        content,
        key: result.key,
        language,
      },
      highlighted: highlightResult.highlighted,
      canonicalPath: buildPath(result.key, ext),
    };
  }

  async load(path: ParsedPath): Promise<DocumentRenderResult> {
    const urlLanguage = path.ext ? resolveLanguage(path.ext) : undefined;
    const result = await this.storage.load(path.key);
    const highlightResult = highlightContent(result.content, urlLanguage ?? result.language);
    // An explicit plain-text extension ('' language) wins over server hints.
    const plain = urlLanguage === '';
    const language = plain ? undefined : highlightResult.language || urlLanguage || result.language;

    return {
      paste: {
        content: result.content,
        key: result.key,
        language,
        frozen: result.frozen,
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
