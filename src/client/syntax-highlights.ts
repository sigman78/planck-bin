/**
 * Syntax highlighting through the CSS Custom Highlight API.
 *
 * highlight.js still tokenizes, but with our own emitter (hljs.configure
 * __emitter, an internal hook - highlight.js is pinned to an exact version in
 * package.json for this reason): instead of a token tree and an HTML string it
 * records text runs against their scope chain, and the runs become character
 * ranges grouped by theme role. The viewer keeps one plain text node and the
 * ranges are painted with ::highlight(syn-<role>) rules, so the DOM never
 * holds per-token spans. Browsers without the API get <span class="syn-<role>">
 * markup built from the same ranges (spansToHtml).
 *
 * Roles mirror solarized-dark-hljs.css: a run takes the role of its innermost
 * scope that the theme styles, so unstyled scopes (params, property, ...)
 * inherit from their parent, like nested spans do in HTML.
 */

/** Role name -> flat [start, end, start, end, ...] offsets into the content. */
export type TokenSpans = Map<string, number[]>;

export const SYNTAX_PREFIX = 'syn-';

const ROLE_BY_SCOPE: Record<string, string> = {
  comment: 'comment',
  quote: 'comment',
  doctag: 'comment',

  keyword: 'keyword',
  type: 'keyword',
  'template-tag': 'keyword',
  name: 'keyword',
  'selector-tag': 'keyword',
  variable: 'keyword',
  'template-variable': 'keyword',
  tag: 'keyword',
  subst: 'keyword',
  attr: 'keyword',
  attribute: 'keyword',
  built_in: 'keyword',

  punctuation: 'punct',
  operator: 'punct',
  bullet: 'punct',

  string: 'constant',
  number: 'constant',
  literal: 'constant',
  regexp: 'constant',
  link: 'constant',
  symbol: 'constant',
  'variable.constant': 'constant',

  'selector-id': 'definition',
  'selector-class': 'definition',
  title: 'definition',
  section: 'definition',

  meta: 'special',
  'meta-keyword': 'special',

  deletion: 'deletion',
  addition: 'addition',
};

const baseScope = (scope: string) => {
  const dot = scope.indexOf('.');
  return dot === -1 ? scope : scope.slice(0, dot);
};

/**
 * One open scope. Runs point at the innermost one; the chain up to the root
 * is the scope stack. An emitter's root is reparented when it is embedded as
 * a sublanguage, so embedded runs still see the host's scopes.
 */
interface ScopeNode {
  scope: string | undefined;
  parent: ScopeNode | null;
  /** Sublanguage name, set on an embedded emitter's root. */
  language?: string;
  // Resolution memo (filled by RangeEmitter.spans).
  role?: string | null;
  inMeta?: boolean;
  lang?: string | undefined;
}

/**
 * hljs emitter that records text runs instead of building a tree. Implements
 * what lib/core.js calls on options.__emitter: addText, startScope/endScope,
 * openNode/closeNode, __addSublanguage, finalize, toHTML.
 */
export class RangeEmitter {
  private readonly root: ScopeNode = { scope: undefined, parent: null };
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

  /** Ranges per role; `language` is the top-level language (result.language). */
  spans(language: string | undefined): TokenSpans {
    const langOf = (node: ScopeNode | null): string | undefined => {
      if (!node) return language;
      if (!('lang' in node)) node.lang = node.language ?? langOf(node.parent);
      return node.lang;
    };
    const inMeta = (node: ScopeNode | null): boolean => {
      if (!node) return false;
      if (node.inMeta === undefined) {
        node.inMeta =
          (node.scope !== undefined && baseScope(node.scope) === 'meta') || inMeta(node.parent);
      }
      return node.inMeta;
    };
    const roleOf = (node: ScopeNode | null): string | null => {
      if (!node) return null;
      if (node.role !== undefined) return node.role;
      let role: string | null = null;
      const scope = node.scope;
      const own =
        scope === undefined ? undefined : (ROLE_BY_SCOPE[scope] ?? ROLE_BY_SCOPE[baseScope(scope)]);
      if (own === undefined) role = roleOf(node.parent);
      // .hljs-meta .hljs-keyword
      else if (baseScope(scope!) === 'keyword' && inMeta(node.parent)) role = 'special';
      // .diff .hljs-meta
      else if (baseScope(scope!) === 'meta' && langOf(node) === 'diff') role = 'diff';
      else role = own;
      node.role = role;
      return role;
    };

    const spans: TokenSpans = new Map();
    for (let i = 0; i < this.starts.length; i++) {
      const role = roleOf(this.nodes[i]);
      if (role === null) continue;
      let list = spans.get(role);
      if (!list) spans.set(role, (list = []));
      // Merge with the previous range when contiguous.
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
 * Ranges for an hljs result produced with RangeEmitter, or null when the runs
 * do not add up to `content` (an illegal-syntax bail-out, or another emitter);
 * the caller then shows plain text.
 */
export function spansFromResult(
  emitter: unknown,
  content: string,
  language: string | undefined
): TokenSpans | null {
  if (!(emitter instanceof RangeEmitter) || emitter.length !== content.length) return null;
  return emitter.spans(language);
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Markup for browsers without the Highlight API: one span per range. */
export function spansToHtml(content: string, spans: TokenSpans): string {
  const runs: [number, number, string][] = [];
  for (const [role, offsets] of spans) {
    for (let i = 0; i < offsets.length; i += 2) runs.push([offsets[i], offsets[i + 1], role]);
  }
  runs.sort((a, b) => a[0] - b[0]);
  let html = '';
  let at = 0;
  for (const [start, end, role] of runs) {
    html += escapeHtml(content.slice(at, start));
    html += `<span class="${SYNTAX_PREFIX}${role}">${escapeHtml(content.slice(start, end))}</span>`;
    at = end;
  }
  return html + escapeHtml(content.slice(at));
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
  for (const [role, offsets] of spans) {
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
    const name = SYNTAX_PREFIX + role;
    registry().set(name, highlight);
    painted.push(name);
  }
}

export function clearSyntax(): void {
  if (painted.length === 0 || !supportsHighlights()) return;
  for (const name of painted) registry().delete(name);
  painted = [];
}
