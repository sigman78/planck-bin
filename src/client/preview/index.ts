/**
 * Preview entry point: the only path from a preview mode to the DOM.
 * The renderer and the sanitizer load on first use, in parallel.
 */

import type { PreviewMode } from './types';
import { MODES } from './registry';

export type { PreviewMode, PreviewIcon } from './types';
export { findPreviewMode } from './registry';

/** Larger content is not rendered (the parse blocks the main thread). */
export const MAX_PREVIEW_CHARS = 512 * 1024;

/**
 * Start fetching the sanitizer and every renderer, for a page that opens
 * straight into a preview: they then load alongside the paste, not after it.
 */
export function preloadPreviews(): void {
  const ignore = () => {}; // A failed load surfaces later, in renderPreview.
  import('./sanitize').catch(ignore);
  for (const mode of MODES) mode.load().catch(ignore);
}

/** The last rendering: toggling back and forth reuses it. */
let cached: { mode: string; content: string; fragment: DocumentFragment } | null = null;

/**
 * Sanitized DOM for `content` in `mode`, ready to insert (a fresh copy each call).
 * @throws Error when the content is too large or a chunk fails to load
 */
export async function renderPreview(mode: PreviewMode, content: string): Promise<DocumentFragment> {
  if (cached && cached.mode === mode.id && cached.content === content) {
    return cached.fragment.cloneNode(true) as DocumentFragment;
  }
  if (content.length > MAX_PREVIEW_CHARS) throw new Error('Too large to preview');

  const [renderer, { sanitizeHtml }] = await Promise.all([mode.load(), import('./sanitize')]);
  const fragment = sanitizeHtml(renderer.render(content));
  cached = { mode: mode.id, content, fragment };
  return fragment.cloneNode(true) as DocumentFragment;
}
