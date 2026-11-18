/**
 * ViewerFind - find-in-paste for the read-only viewer.
 *
 * The viewer holds the paste as one text node; matches are painted over it
 * with the CSS Custom Highlight API, above the syntax highlights. Without the
 * API, find still counts matches and scrolls to them, unpainted.
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

  /**
   * @param root element whose text is searched (the viewer's code element)
   * @param scroller horizontally scrolling ancestor (the viewer pre)
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement
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
    }
    this.reveal(current);
  }

  /** Scroll the page vertically and the viewer horizontally to the match. */
  private reveal(range: Range): void {
    const rect = range.getBoundingClientRect();
    const top = rect.top + window.scrollY - window.innerHeight / 2 + rect.height / 2;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });

    const box = this.scroller.getBoundingClientRect();
    if (rect.left < box.left || rect.right > box.right) {
      this.scroller.scrollLeft += rect.left - box.left - box.width / 2;
    }
  }
}
