import type { Page } from '@playwright/test';

/**
 * Texts painted by syntax highlights (CSS Custom Highlight API, names hl-N;
 * see src/client/highlight-theme.ts), one entry per range.
 */
export function paintedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const registry = CSS.highlights as unknown as Map<string, Highlight>;
    const texts: string[] = [];
    for (const [name, highlight] of registry) {
      if (!name.startsWith('hl-')) continue;
      for (const range of highlight as unknown as Set<Range>) texts.push(range.toString());
    }
    return texts;
  });
}

/** Number of syntax highlights currently registered. */
export function syntaxHighlightCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const registry = CSS.highlights as unknown as Map<string, Highlight>;
    return [...registry.keys()].filter((name) => name.startsWith('hl-')).length;
  });
}
