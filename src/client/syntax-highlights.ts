/**
 * Syntax highlighting through the CSS Custom Highlight API.
 *
 * highlight.js still tokenizes; instead of using its HTML output we walk its
 * token tree (result._emitter.rootNode, internal API - highlight.js is pinned
 * to an exact version in package.json for this reason) and turn it into
 * character ranges grouped by theme role. The viewer then keeps one plain text
 * node and the ranges are painted with ::highlight(syn-<role>) rules, so the
 * DOM never holds per-token spans.
 *
 * Roles mirror the rules in solarized-dark-hljs.css: a token takes the role
 * of its innermost scope that the theme styles, so unstyled scopes (params,
 * property, ...) inherit from their parent, like nested spans do in HTML.
 */

/** Role name -> flat [start, end, start, end, ...] offsets into the content. */
export type TokenSpans = Map<string, number[]>;

/** hljs token tree node (lib/core.js TokenTree): text or a scoped group. */
type TreeNode = string | { scope?: string; children: TreeNode[] };

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

/** Role for a text leaf under `stack` (outermost first), or null for base text. */
function resolveRole(stack: string[], language: string | undefined): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const scope = stack[i];
    const base = baseScope(scope);
    const role = ROLE_BY_SCOPE[scope] ?? ROLE_BY_SCOPE[base];
    if (role === undefined) continue;
    // .hljs-meta .hljs-keyword
    if (base === 'keyword' && stack.slice(0, i).some((s) => baseScope(s) === 'meta')) {
      return 'special';
    }
    // .diff .hljs-meta
    if (base === 'meta' && language === 'diff') return 'diff';
    return role;
  }
  return null;
}

/**
 * Ranges per role for an hljs token tree. Returns null when the tree's text
 * does not add up to `content` (offsets would be wrong; caller falls back to
 * the HTML output).
 */
export function extractSpans(
  root: unknown,
  content: string,
  language: string | undefined
): TokenSpans | null {
  const spans: TokenSpans = new Map();
  const stack: string[] = [];
  const langStack: (string | undefined)[] = [language];
  let offset = 0;

  const push = (role: string, start: number, end: number) => {
    let list = spans.get(role);
    if (!list) spans.set(role, (list = []));
    // Merge with the previous range when contiguous.
    if (list.length > 0 && list[list.length - 1] === start) list[list.length - 1] = end;
    else list.push(start, end);
  };

  const walk = (node: TreeNode): void => {
    if (typeof node === 'string') {
      const end = offset + node.length;
      const role = resolveRole(stack, langStack[langStack.length - 1]);
      if (role !== null && end > offset) push(role, offset, end);
      offset = end;
      return;
    }
    const scope = node.scope;
    const sublanguage = scope?.startsWith('language:') ? scope.slice(9) : undefined;
    if (sublanguage !== undefined) langStack.push(sublanguage);
    else if (scope) stack.push(scope);
    for (const child of node.children) walk(child);
    if (sublanguage !== undefined) langStack.pop();
    else if (scope) stack.pop();
  };

  if (
    !root ||
    typeof root !== 'object' ||
    !Array.isArray((root as { children?: unknown }).children)
  ) {
    return null;
  }
  walk(root as TreeNode);
  return offset === content.length ? spans : null;
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
