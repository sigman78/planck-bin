/**
 * Print listing: a paper-friendly copy of the paste, built just before the
 * browser prints and removed after.
 *
 * The screen view cannot print well: the gutter is a separate column next to
 * one text node, so wrapping long lines would misalign the numbers. The
 * listing puts each line in its own row (number + text), so wrapped lines keep
 * their number, and paints the same syntax ranges over the per-line text
 * nodes. The ranges join the Highlight objects already registered for the
 * viewer, so the compiled ::highlight() rules apply unchanged; print colors
 * come from the theme variables redefined on #print-listing (application.css).
 */

import type { TokenSpans } from './syntax-highlights';
import { supportsHighlights } from './syntax-highlights';

export interface PrintSource {
  /** Text as shown (LF line endings). */
  text: string;
  /** Syntax spans painted over `text`, or null for plain text. */
  spans: TokenSpans | null;
  /** Number the lines (the lineNumbers option). */
  numbers: boolean;
}

const LISTING_ID = 'print-listing';
const PAGE_STYLE_ID = 'print-page';

/** The registry is map-like at runtime; older DOM typings omit the Map methods. */
const registry = () => CSS.highlights as unknown as Map<string, Highlight>;

/** CSS string literal for generated content. */
const cssString = (value: string) => `"${value.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;

export class PrintListing {
  /** Ranges added to the viewer's highlights for the listing, to take back after printing. */
  private added: [Highlight, Range][] = [];

  constructor(private readonly source: () => PrintSource | null) {
    window.addEventListener('beforeprint', () => this.build());
    window.addEventListener('afterprint', () => this.teardown());
  }

  /** Build the listing and the page header/footer for the current paste. */
  build(): void {
    this.teardown();
    const src = this.source();
    if (!src) return;

    const lines = src.text.split('\n');
    const listing = document.createElement('div');
    listing.id = LISTING_ID;
    listing.setAttribute('aria-hidden', 'true');
    if (!src.numbers) listing.classList.add('no-numbers');
    listing.style.setProperty('--print-digits', String(String(lines.length).length));

    const nodes: Text[] = [];
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      const row = document.createElement('div');
      row.className = 'pl-row';
      const num = document.createElement('span');
      num.className = 'pl-num';
      num.textContent = String(i + 1);
      const code = document.createElement('span');
      code.className = 'pl-code';
      const text = document.createTextNode(line);
      code.appendChild(text);
      row.appendChild(num);
      row.appendChild(code);
      frag.appendChild(row);
      nodes.push(text);
    });
    listing.appendChild(frag);
    document.body.appendChild(listing);

    if (src.spans && supportsHighlights()) this.paint(src.spans, lines, nodes);
    this.setPageBoxes(lines.length);
  }

  teardown(): void {
    for (const [highlight, range] of this.added) {
      (highlight as unknown as Set<AbstractRange>).delete(range);
    }
    this.added = [];
    document.getElementById(LISTING_ID)?.remove();
    document.getElementById(PAGE_STYLE_ID)?.remove();
  }

  /** Split each span at line breaks and add it over the per-line text nodes. */
  private paint(spans: TokenSpans, lines: string[], nodes: Text[]): void {
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1; // the LF
    }
    // Last line starting at or before `pos`.
    const lineAt = (pos: number) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    for (const [name, offsets] of spans) {
      let highlight = registry().get(name);
      if (!highlight) {
        highlight = new Highlight();
        registry().set(name, highlight);
      }
      const ranges = highlight as unknown as Set<AbstractRange>;
      for (let i = 0; i < offsets.length; i += 2) {
        const start = offsets[i];
        const end = offsets[i + 1];
        for (let l = lineAt(start); l < lines.length && starts[l] < end; l++) {
          const from = Math.max(start - starts[l], 0);
          const to = Math.min(end - starts[l], lines[l].length);
          if (to <= from) continue;
          const range = new Range();
          range.setStart(nodes[l], from);
          range.setEnd(nodes[l], to);
          ranges.add(range);
          this.added.push([highlight, range]);
        }
      }
    }
  }

  /** Running header (address, line count) and page numbers in the page margins. */
  private setPageBoxes(lineCount: number): void {
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    const where = `${location.host}${location.pathname === '/' ? '' : location.pathname}`;
    const count = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
    style.textContent =
      `@page { @top-left { content: ${cssString(where)}; } ` +
      `@top-right { content: ${cssString(count)}; } }`;
    document.head.appendChild(style);
  }
}
