/**
 * Run-time compiler from a stock highlight.js theme to Custom Highlight API
 * rules.
 *
 * A theme styles nested spans (.hljs-keyword, .hljs-title.function_,
 * .hljs-meta .hljs-keyword, ...); ::highlight(name) can only match a flat
 * name. So the token rules are read from the loaded stylesheets, and for each
 * scope chain the emitter produces we compute what the browser would have
 * applied to the innermost span: matching rules by specificity then source
 * order, and a property no rule sets on that span comes from its nearest
 * ancestor that has one (color and text-shadow inherit; backgrounds and
 * decorations of an enclosing span paint behind or through it). Each distinct
 * result becomes one ::highlight(hl-N) rule, injected into a <style>.
 *
 * The theme stylesheet itself stays loaded as published: its .hljs root rule
 * styles the <code class="hljs"> element natively, its token rules match
 * nothing in the DOM and are only read here. Properties ::highlight() cannot
 * paint (font-weight, font-style, padding, border-radius) are dropped.
 */

import type { RangeEmitter, ScopeNode, TokenSpans } from './syntax-highlights';

export const HIGHLIGHT_PREFIX = 'hl-';

/** What ::highlight() can paint, in output order. */
const PROPERTIES = ['color', 'background-color', 'text-decoration', 'text-shadow'];

/** An element in the rendered chain: pre > code.hljs > span... */
interface ChainElement {
  tag: string;
  classes: string[];
}

interface Compound {
  tag?: string;
  classes: string[];
}

interface TokenRule {
  /** Descendant chain, outermost first; the last one matches the token. */
  compounds: Compound[];
  specificity: number;
  order: number;
  declarations: [string, string][];
}

const UNSUPPORTED = /[>+~:[\]#*()|\\"']/;
const COMPOUND = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/;

/** Parse one selector; null when it is not a plain token selector. */
function parseSelector(selector: string): Pick<TokenRule, 'compounds' | 'specificity'> | null {
  if (selector === '' || UNSUPPORTED.test(selector)) return null;
  const compounds: Compound[] = [];
  let specificity = 0;
  for (const part of selector.split(/\s+/)) {
    const match = COMPOUND.exec(part);
    if (!match || part === '') return null;
    const classes = match[2] ? match[2].slice(1).split('.') : [];
    compounds.push({ tag: match[1]?.toLowerCase(), classes });
    specificity += classes.length * 256 + (match[1] ? 1 : 0);
  }
  const last = compounds[compounds.length - 1];
  if (!last.classes.some((c) => c.startsWith('hljs-'))) return null;
  return { compounds, specificity };
}

/** Class list hljs renders for a scope: "title.function" -> hljs-title function_. */
function scopeClasses(scope: string): string[] {
  const [first, ...rest] = scope.split('.');
  return ['hljs-' + first, ...rest.map((piece, i) => piece + '_'.repeat(i + 1))];
}

const matches = (compound: Compound, el: ChainElement) =>
  (compound.tag === undefined || compound.tag === el.tag) &&
  compound.classes.every((c) => el.classes.includes(c));

/** Descendant-only selector match for chain[index] (greedy is exact here). */
function ruleMatches(rule: TokenRule, chain: ChainElement[], index: number): boolean {
  const { compounds } = rule;
  if (!matches(compounds[compounds.length - 1], chain[index])) return false;
  let at = index - 1;
  for (let k = compounds.length - 2; k >= 0; k--) {
    while (at >= 0 && !matches(compounds[k], chain[at])) at--;
    if (at < 0) return false;
    at--;
  }
  return true;
}

/** Style rules from sheets, recursing into applicable grouping rules. */
function collectStyleRules(rules: CSSRuleList, out: CSSStyleRule[]): void {
  for (const rule of Array.from(rules)) {
    if ('selectorText' in rule && 'style' in rule) {
      out.push(rule as CSSStyleRule);
    } else if ('cssRules' in rule) {
      const media = (rule as CSSMediaRule).media;
      const applies =
        !media || typeof matchMedia !== 'function' || matchMedia(media.mediaText).matches;
      if (applies) collectStyleRules((rule as CSSGroupingRule).cssRules, out);
    }
  }
}

export class HighlightTheme {
  private readonly names = new Map<string, string>();
  private readonly byChain = new Map<string, string | null>();
  private cssText = '';
  /** Called with the full ::highlight() stylesheet whenever it grows. */
  onCss?: (cssText: string) => void;

  private constructor(private readonly rules: TokenRule[]) {}

  static fromSheets(sheets: Iterable<CSSStyleSheet>): HighlightTheme {
    const styleRules: CSSStyleRule[] = [];
    for (const sheet of sheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin
      }
      collectStyleRules(rules, styleRules);
    }
    const rules: TokenRule[] = [];
    styleRules.forEach((rule, order) => {
      const declarations: [string, string][] = [];
      for (const property of PROPERTIES) {
        const value = rule.style.getPropertyValue(property).trim();
        if (value !== '') declarations.push([property, value]);
      }
      if (declarations.length === 0) return;
      for (const selector of rule.selectorText.split(',')) {
        const parsed = parseSelector(selector.trim());
        if (parsed) rules.push({ ...parsed, order, declarations });
      }
    });
    return new HighlightTheme(rules);
  }

  /** Whether any token rule was found (a theme is loaded). */
  get empty(): boolean {
    return this.rules.length === 0;
  }

  /** The generated ::highlight() rules. */
  get css(): string {
    return this.cssText;
  }

  spans(runs: RangeEmitter): TokenSpans {
    return runs.spans(this.resolve);
  }

  /** Highlight name for a run's innermost scope, or null for base text. */
  readonly resolve = (node: ScopeNode): string | null => {
    if (node.memo?.owner === this) return node.memo.name;
    const chain = chainOf(node);
    const key = chain.map((el) => el.tag + '.' + el.classes.join('.')).join(' ');
    let name = this.byChain.get(key);
    if (name === undefined) {
      name = this.nameFor(this.computeStyle(chain));
      this.byChain.set(key, name);
    }
    node.memo = { owner: this, name };
    return name;
  };

  private computeStyle(chain: ChainElement[]): string {
    const style = new Map<string, string>();
    // Innermost element first: what it declares wins over what it inherits.
    for (let i = chain.length - 1; i >= 0 && style.size < PROPERTIES.length; i--) {
      const matched = this.rules
        .filter((rule) => ruleMatches(rule, chain, i))
        .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
      const own = new Map<string, string>();
      for (const rule of matched) for (const [p, v] of rule.declarations) own.set(p, v);
      for (const [p, v] of own) if (!style.has(p)) style.set(p, v);
    }
    return PROPERTIES.filter((p) => style.has(p))
      .map((p) => `${p}: ${style.get(p)};`)
      .join(' ');
  }

  private nameFor(declarations: string): string | null {
    if (declarations === '') return null;
    let name = this.names.get(declarations);
    if (name === undefined) {
      name = HIGHLIGHT_PREFIX + this.names.size;
      this.names.set(declarations, name);
      this.cssText += `::highlight(${name}) { ${declarations} }\n`;
      this.onCss?.(this.cssText);
    }
    return name;
  }
}

/** pre > code.hljs > the spans hljs would render for this scope chain. */
function chainOf(node: ScopeNode): ChainElement[] {
  const spans: ChainElement[] = [];
  for (let n: ScopeNode | null = node; n; n = n.parent) {
    if (n.scope) spans.push({ tag: 'span', classes: scopeClasses(n.scope) });
    else if (n.language) spans.push({ tag: 'span', classes: ['language-' + n.language] });
  }
  spans.reverse();
  return [{ tag: 'pre', classes: [] }, { tag: 'code', classes: ['hljs'] }, ...spans];
}

const STYLE_ID = 'highlight-theme';
let current: HighlightTheme | null = null;

/** The theme compiled from the document's stylesheets (compiled on first use). */
export function currentTheme(): HighlightTheme {
  if (current) return current;
  const theme = HighlightTheme.fromSheets(Array.from(document.styleSheets));
  theme.onCss = (cssText) => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = cssText;
  };
  // Stylesheets may not be ready yet; try again next time.
  if (!theme.empty) current = theme;
  return theme;
}

/** Forget the compiled theme (after swapping the theme stylesheet). */
export function resetTheme(): void {
  current = null;
  document.getElementById(STYLE_ID)?.remove();
}
