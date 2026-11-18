/**
 * ViewerFind - find-in-paste for the read-only viewer.
 *
 * Matches are painted with the CSS Custom Highlight API when available
 * (no DOM mutation of the highlighted code); otherwise the current match is
 * selected with the regular text selection.
 */

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

interface TextSpan {
  node: Text;
  start: number;
}

const supportsHighlights = () => typeof CSS !== 'undefined' && 'highlights' in CSS;

/** The registry is map-like at runtime; older DOM typings omit the Map methods. */
const highlightRegistry = () => CSS.highlights as unknown as Map<string, Highlight>;

export class ViewerFind {
  private ranges: Range[] = [];
  private index = -1;
  private usedSelection = false;

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
    if (query === '') return this.status();

    const spans = this.collectText();
    const text = spans.map((s) => s.node.data).join('');
    this.ranges = this.rangesFor(spans, findOffsets(text, query), query.length);
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

  private collectText(): TextSpan[] {
    const spans: TextSpan[] = [];
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      spans.push({ node: text, start: offset });
      offset += text.data.length;
    }
    return spans;
  }

  /**
   * Map sorted match offsets to Ranges in one forward pass over the text
   * spans (a highlighted paste can have tens of thousands of nodes).
   */
  private rangesFor(spans: TextSpan[], starts: number[], length: number): Range[] {
    let cursor = 0;
    const locate = (offset: number, preferEnd: boolean) => {
      while (cursor < spans.length - 1) {
        const span = spans[cursor];
        const spanEnd = span.start + span.node.data.length;
        if (offset < spanEnd || (preferEnd && offset === spanEnd)) break;
        cursor++;
      }
      const span = spans[cursor];
      return { node: span.node, offset: Math.min(offset - span.start, span.node.data.length) };
    };
    return starts.map((start) => {
      const from = locate(start, false);
      const to = locate(start + length, true);
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      return range;
    });
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
