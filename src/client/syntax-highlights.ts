/**
 * Syntax highlighting through the CSS Custom Highlight API.
 *
 * highlight.js still tokenizes, but with our own emitter (hljs.configure
 * __emitter, an internal hook - highlight.js is pinned to an exact version in
 * package.json for this reason): instead of a token tree and an HTML string it
 * records text runs against their scope chain. highlight-theme.ts resolves
 * each chain against the loaded highlight.js theme, and the runs are painted
 * as ranges over the viewer's single text node. Without the API the paste is
 * shown as plain text.
 */

/** Highlight name -> flat [start, end, start, end, ...] offsets into the content. */
export type TokenSpans = Map<string, number[]>;

/**
 * One open scope. Runs point at the innermost one; the chain up to the root
 * is the scope stack, i.e. the nested spans highlight.js would have rendered.
 * An emitter's root is reparented when it is embedded as a sublanguage, so
 * embedded runs still see the host's scopes.
 */
export interface ScopeNode {
  /** hljs scope, e.g. "keyword" or "title.function". */
  scope?: string;
  parent: ScopeNode | null;
  /** Sublanguage name, set on an embedded emitter's root. */
  language?: string;
  /** Resolution memo, owned by highlight-theme.ts. */
  memo?: { owner: object; name: string | null };
}

/**
 * hljs emitter that records text runs instead of building a tree. Implements
 * what lib/core.js calls on options.__emitter: addText, startScope/endScope,
 * openNode/closeNode, __addSublanguage, finalize, toHTML.
 */
export class RangeEmitter {
  private readonly root: ScopeNode = { parent: null };
  private top: ScopeNode = this.root;
  private offset = 0;
  // Runs as parallel arrays: [start, end) and the innermost scope.
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private readonly nodes: ScopeNode[] = [];

  /** Length of the text emitted so far. */
  get length(): number {
    return this.offset;
  }

  addText(text: string): void {
    if (text === '') return;
    this.starts.push(this.offset);
    this.offset += text.length;
    this.ends.push(this.offset);
    this.nodes.push(this.top);
  }

  startScope(scope: string): void {
    this.openNode(scope);
  }

  endScope(): void {
    this.closeNode();
  }

  openNode(scope: string): void {
    this.top = { scope, parent: this.top };
  }

  closeNode(): void {
    if (this.top.parent) this.top = this.top.parent;
  }

  __addSublanguage(emitter: RangeEmitter, name: string): void {
    emitter.root.parent = this.top;
    if (name) emitter.root.language = name;
    const shift = this.offset;
    for (let i = 0; i < emitter.starts.length; i++) {
      this.starts.push(emitter.starts[i] + shift);
      this.ends.push(emitter.ends[i] + shift);
      this.nodes.push(emitter.nodes[i]);
    }
    this.offset += emitter.offset;
  }

  finalize(): boolean {
    this.top = this.root;
    return true;
  }

  /** hljs stores this as result.value; nothing reads it. */
  toHTML(): string {
    return '';
  }

  /**
   * Ranges per highlight name; `resolve` maps a run's innermost scope to a
   * name, or null for unstyled text. Contiguous runs of one name merge.
   */
  spans(resolve: (node: ScopeNode) => string | null): TokenSpans {
    const spans: TokenSpans = new Map();
    for (let i = 0; i < this.starts.length; i++) {
      const name = resolve(this.nodes[i]);
      if (name === null) continue;
      let list = spans.get(name);
      if (!list) spans.set(name, (list = []));
      if (list.length > 0 && list[list.length - 1] === this.starts[i]) {
        list[list.length - 1] = this.ends[i];
      } else {
        list.push(this.starts[i], this.ends[i]);
      }
    }
    return spans;
  }
}

/**
 * The runs of an hljs result produced with RangeEmitter, or null when they do
 * not add up to `content` (an illegal-syntax bail-out, or another emitter).
 */
export function runsFromResult(emitter: unknown, content: string): RangeEmitter | null {
  return emitter instanceof RangeEmitter && emitter.length === content.length ? emitter : null;
}

export const supportsHighlights = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** The registry is map-like at runtime; older DOM typings omit the Map methods. */
const registry = () => CSS.highlights as unknown as Map<string, Highlight>;

let painted: string[] = [];

/** Paint `spans` over a single text node, replacing any earlier syntax paint. */
export function paintSyntax(text: Text, spans: TokenSpans): void {
  clearSyntax();
  const length = text.data.length;
  for (const [name, offsets] of spans) {
    const highlight = new Highlight();
    // Set-like at runtime; older DOM typings omit the Set methods.
    const ranges = highlight as unknown as Set<AbstractRange>;
    for (let i = 0; i < offsets.length; i += 2) {
      if (offsets[i + 1] > length) break;
      const range = new Range();
      range.setStart(text, offsets[i]);
      range.setEnd(text, offsets[i + 1]);
      ranges.add(range);
    }
    registry().set(name, highlight);
    painted.push(name);
  }
}

export function clearSyntax(): void {
  if (painted.length === 0 || !supportsHighlights()) return;
  for (const name of painted) registry().delete(name);
  painted = [];
}
