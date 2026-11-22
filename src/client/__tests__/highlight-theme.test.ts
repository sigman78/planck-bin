import { highlightContent } from '../highlight-config';
import { HighlightTheme } from '../highlight-theme';

// Jest runs under Node; the project tsconfig has no Node types.
declare const require: (id: string) => { readFileSync(path: string, enc: string): string };
declare const __dirname: string;

function compile(css: string): HighlightTheme {
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return HighlightTheme.fromSheets(Array.from(document.styleSheets));
}

/** Token runs as [start, end, declarations] triples. */
function paintedRuns(theme: HighlightTheme, content: string, language?: string) {
  const spans = theme.spans(highlightContent(content, language).highlighted.runs!);
  const decls = new Map<string, string>();
  for (const line of theme.css.trim().split('\n')) {
    const m = /^::highlight\(([\w-]+)\) \{ (.*) \}$/.exec(line);
    if (m) decls.set(m[1], m[2]);
  }
  const out: [number, number, string][] = [];
  for (const [name, offsets] of spans) {
    for (let i = 0; i < offsets.length; i += 2)
      out.push([offsets[i], offsets[i + 1], decls.get(name)!]);
  }
  return out;
}

/** Declarations painted on each token text ('' for base text). */
function painted(theme: HighlightTheme, content: string, language?: string) {
  const out = new Map<string, string>();
  for (const [start, end, d] of paintedRuns(theme, content, language))
    out.set(content.slice(start, end), d);
  return (text: string) => out.get(text) ?? '';
}

/** Declarations painted over the first occurrence of text, even inside a merged run. */
function paintedAt(theme: HighlightTheme, content: string, language?: string) {
  const runs = paintedRuns(theme, content, language);
  return (text: string) => {
    const at = content.indexOf(text);
    return runs.find(([start, end]) => start <= at && at + text.length <= end)?.[2] ?? '';
  };
}

describe('HighlightTheme with the bundled Solarized theme', () => {
  const css = require('node:fs').readFileSync(`${__dirname}/../solarized-dark-hljs.css`, 'utf8');

  it('applies plain token rules', () => {
    const p = painted(compile(css), 'const x = "hi"; // note\nfunction f(a) {}', 'javascript');
    expect(p('const')).toBe('color: var(--syntax-keyword);');
    expect(p('"hi"')).toBe('color: var(--syntax-constant);');
    expect(p('// note')).toBe(
      'color: var(--syntax-comment); background-color: var(--syntax-comment-bg);'
    );
    expect(p('f')).toBe('color: var(--syntax-definition);');
    // .hljs-params has an empty rule: base text
    expect(p('a')).toBe('');
  });

  it('applies descendant rules by specificity', () => {
    const p = painted(compile(css), '#include <stdio.h>\nint main() {}', 'cpp');
    // .hljs-meta .hljs-keyword beats .hljs-keyword (so "#" and "include" merge)
    expect(p('#include ')).toBe('color: var(--syntax-special);');
    expect(p('<stdio.h>')).toBe('color: var(--syntax-constant);');
  });

  it('does not match .diff (no such element), like the span renderer', () => {
    const p = painted(compile(css), '@@ -1 +1 @@\n-a\n+b', 'diff');
    expect(p('@@ -1 +1 @@')).toBe('color: var(--syntax-special);');
    expect(p('-a')).toBe('color: var(--syntax-deletion);');
  });

  it('drops what ::highlight() cannot paint', () => {
    const p = painted(compile(css), 'some **bold** text', 'markdown');
    expect(p('**bold**')).toBe('');
  });
});

describe('HighlightTheme with a stock-style theme', () => {
  const css = `
    .hljs { color: black; background: white; }
    .hljs-title.function_ { color: blue; }
    .hljs-title { color: red; }
    .hljs-string { color: green; background-color: yellow; }
    .hljs-subst { color: black; }
    pre code.hljs .hljs-number { color: purple; }
    .hljs-keyword:hover { color: pink; }
    .hljs-keyword { color: navy; font-weight: bold; }
    .language-javascript .hljs-keyword { color: orange; }
    .hljs-comment { font-style: italic; }
  `;

  it('resolves compound, descendant and inherited styles', () => {
    const theme = compile(css);
    const p = painted(theme, 'function f() { return `a${x}` + 1; } // c', 'javascript');
    // compound selector outranks the later, simpler rule
    expect(p('f')).toBe('color: blue;');
    // the subst sets color but inherits the string background
    expect(p('`a')).toBe('color: green; background-color: yellow;');
    expect(p('${x}')).toBe('color: black; background-color: yellow;');
    expect(p('1')).toBe('color: purple;');
    // :hover rule ignored, font-weight dropped
    expect(p('return')).toBe('color: navy;');
    // italic only: nothing to paint
    expect(p('// c')).toBe('');
  });

  it('matches language classes of embedded code', () => {
    const p = painted(compile(css), '<script>let a = 1;</script>', 'xml');
    expect(p('let')).toBe('color: orange;');
  });

  it('shares one highlight per distinct style', () => {
    const theme = compile(css);
    painted(theme, 'let a = 1; const b = 2; var c = 3;', 'javascript');
    expect(theme.css.match(/color: navy;/g)).toHaveLength(1);
  });

  it('is empty when no token rules are loaded', () => {
    expect(compile('.hljs { color: red }').empty).toBe(true);
  });

  it('resolves inherit against the enclosing token', () => {
    const theme = compile('.hljs-tag { color: blue } .hljs-attr { color: inherit }');
    expect(paintedAt(theme, '<a href="x">', 'xml')('href')).toBe('color: blue;');
    expect(theme.css).not.toContain('inherit');
  });

  it('lets inherit override a weaker own rule', () => {
    const theme = compile(
      '.hljs-tag { color: blue } .hljs-attr { color: red } .hljs-tag .hljs-attr { color: inherit }'
    );
    expect(paintedAt(theme, '<a href="x">', 'xml')('href')).toBe('color: blue;');
  });

  it('matches child combinators', () => {
    const theme = compile(
      'code > .hljs-keyword { color: red } pre > .hljs-keyword { color: green }' +
        ' .hljs-tag>.hljs-attr { color: blue } code > .hljs-attr { color: olive }'
    );
    expect(painted(theme, 'let a;', 'javascript')('let')).toBe('color: red;');
    expect(paintedAt(theme, '<a href="x">', 'xml')('href')).toBe('color: blue;');
  });

  it('skips selectors it cannot evaluate', () => {
    const theme = compile(
      '.hljs-keyword { color: red } .hljs-keyword:hover { color: blue } > .hljs-keyword { color: green }'
    );
    expect(painted(theme, 'let a;', 'javascript')('let')).toBe('color: red;');
  });
});
