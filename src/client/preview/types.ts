/**
 * Preview modes: alternative presentations of a saved paste (rendered
 * markdown now; tables for CSV or a tree for JSON could follow).
 *
 * A mode only produces an HTML string. Turning it into DOM is the job of
 * renderPreview (./index.ts), which always passes it through the one
 * sanitizer, so no mode can put unsanitized markup on the page.
 */

export interface PreviewRenderer {
  /** HTML for `content`; sanitized by the caller before it reaches the DOM. */
  render(content: string): string;
}

/** A stroked outline icon (currentColor), drawn at its viewBox size in px. */
export interface PreviewIcon {
  width: number;
  height: number;
  paths: readonly string[];
}

export interface PreviewMode {
  id: string;
  /** Command label that turns it on, e.g. "Preview markdown". */
  label: string;
  /** Shown alone on the island chip; the label is its tooltip. */
  icon: PreviewIcon;
  /** Whether this mode can present a paste in `language` (highlight.js id). */
  matches(language: string | undefined, content: string): boolean;
  /** The renderer, in its own chunk: fetched on first use only. */
  load(): Promise<PreviewRenderer>;
}
