import type { Page } from '@playwright/test';

/**
 * Text painted with one syntax role (CSS Custom Highlight API, see
 * src/client/syntax-highlights.ts), one entry per range.
 */
export function syntaxTexts(page: Page, role: string): Promise<string[]> {
  return page.evaluate((name) => {
    const registry = CSS.highlights as unknown as Map<string, Highlight>;
    const highlight = registry.get(name);
    return highlight ? [...highlight].map((range) => (range as Range).toString()) : [];
  }, `syn-${role}`);
}

/** Number of syntax highlights currently registered. */
export function syntaxHighlightCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const registry = CSS.highlights as unknown as Map<string, Highlight>;
    return [...registry.keys()].filter((name) => name.startsWith('syn-')).length;
  });
}
