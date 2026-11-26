/**
 * ViewerFind - find-in-paste for the read-only viewer.
 *
 * The viewer holds the paste as one text node; matches are painted over it
 * with the CSS Custom Highlight API, above the syntax highlights. Without the
 * API, the current match is shown with the regular text selection instead.
 */

import { supportsHighlights } from './syntax-highlights';

export interface FindStatus {
  current: number;
  total: number;
}

const MAX_MATCHES = 1000;
const HL_ALL = 'haste-find';
const HL_CURRENT = 'haste-find-current';

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive, non-overlapping match start offsets. */
export function findOffsets(text: string, query: string, limit = MAX_MATCHES): number[] {
  if (query === '') return [];
  const re = new RegExp(escapeRegex(query), 'gi');
  const offsets: number[] = [];
  let match: RegExpExecArray | null;
  while (offsets.length < limit && (match = re.exec(text)) !== null) {
    offsets.push(match.index);
  }
  return offsets;
}

/** The registry is map-like at runtime; older DOM typings omit the Map methods. */
const highlightRegistry = () => CSS.highlights as unknown as Map<string, Highlight>;

export class ViewerFind {
  private ranges: Range[] = [];
  private index = -1;
  private usedSelection = false;

  /**
   * @param root element whose text is searched (the viewer's code element)
   * @param cover element pinned over the window's left edge (the gutter), if any
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly cover?: HTMLElement
  ) {}

  search(query: string): FindStatus {
    this.clear();
    const text = this.root.firstChild;
    if (query === '' || !(text instanceof Text)) return this.status();

    this.ranges = findOffsets(text.data, query).map((start) => {
      const range = new Range();
      range.setStart(text, start);
      range.setEnd(text, start + query.length);
      return range;
    });
    if (this.ranges.length > 0) {
      this.index = 0;
      this.paint();
    }
    return this.status();
  }

  step(direction: 1 | -1): FindStatus {
    const total = this.ranges.length;
    if (total === 0) return this.status();
    this.index = (this.index + direction + total) % total;
    this.paint();
    return this.status();
  }

  clear(): void {
    if (supportsHighlights()) {
      highlightRegistry().delete(HL_ALL);
      highlightRegistry().delete(HL_CURRENT);
    }
    if (this.usedSelection) {
      window.getSelection()?.removeAllRanges();
      this.usedSelection = false;
    }
    this.ranges = [];
    this.index = -1;
  }

  private status(): FindStatus {
    return { current: this.index + 1, total: this.ranges.length };
  }

  private paint(): void {
    const current = this.ranges[this.index];
    if (!current) return;

    if (supportsHighlights()) {
      // Above the syntax highlights (priority 0), which also set colors.
      const all = new Highlight(...this.ranges);
      const now = new Highlight(current);
      all.priority = 1;
      now.priority = 2;
      highlightRegistry().set(HL_ALL, all);
      highlightRegistry().set(HL_CURRENT, now);
    } else {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(current);
      this.usedSelection = true;
    }
    this.reveal(current);
  }

  /**
   * Scroll the page to the match: vertically to mid-window, and horizontally
   * (long lines scroll the page) only when the match is outside the visible
   * columns: right of the pinned gutter, left of the vertical scrollbar.
   */
  private reveal(range: Range): void {
    const rect = range.getBoundingClientRect();
    const top = rect.top + window.scrollY - window.innerHeight / 2 + rect.height / 2;
    const from = Math.max(0, this.cover?.getBoundingClientRect().right ?? 0);
    const to = document.documentElement.clientWidth;
    const offscreen = rect.left < from || rect.right > to;
    const left = offscreen
      ? rect.left + window.scrollX - (from + to) / 2 + rect.width / 2
      : window.scrollX;
    window.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'instant' });
  }
}
