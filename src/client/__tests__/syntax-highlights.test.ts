import hljs, { highlightContent } from '../highlight-config';
import { RangeEmitter, spansFromResult, spansToHtml, type TokenSpans } from '../syntax-highlights';

/** Text covered by each role, in order. */
function covered(content: string, spans: TokenSpans): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [role, offsets] of spans) {
    out[role] = [];
    for (let i = 0; i < offsets.length; i += 2) {
      out[role].push(content.slice(offsets[i], offsets[i + 1]));
    }
  }
  return out;
}

const roles = (content: string, language?: string) =>
  covered(content, highlightContent(content, language).highlighted.spans);

describe('RangeEmitter', () => {
  it('is the emitter hljs uses, and produces no HTML', () => {
    const result = hljs.highlight('const x = 1;', { language: 'javascript' });
    expect(result._emitter).toBeInstanceOf(RangeEmitter);
    expect(result.value).toBe('');
  });

  it('maps hljs tokens to theme roles with exact offsets', () => {
    const r = roles('const x = "hi"; // note\nfunction f(a) { return 42; }', 'javascript');
    expect(r.keyword).toEqual(expect.arrayContaining(['const', 'function', 'return']));
    expect(r.constant).toEqual(expect.arrayContaining(['"hi"', '42']));
    expect(r.comment).toEqual(['// note']);
    expect(r.definition).toEqual(['f']);
    // params scope is unstyled: "a" stays base text
    expect(Object.values(r).flat()).not.toContain('a');
  });

  it('keeps offsets aligned across CRLF and sublanguages', () => {
    const r = roles('<p>\r\n<script>let a = 1;</script>\r\n</p>', 'xml');
    // "<script>" and "let" are both keyword-colored and adjacent, so merged.
    expect(r.keyword).toEqual(['<p>', '<script>let', '</script>', '</p>']);
    expect(r.constant).toEqual(['1']);
  });

  it('applies contextual roles (keyword inside meta, diff meta)', () => {
    expect(roles('#include <stdio.h>\nint main() {}', 'cpp').special?.join('')).toContain(
      'include'
    );
    const d = roles('@@ -1 +1 @@\n-a\n+b', 'diff');
    expect(d.diff).toEqual(['@@ -1 +1 @@']);
    expect(d.deletion).toEqual(['-a']);
    expect(d.addition).toEqual(['+b']);
  });

  it('lets embedded runs inherit the host scope chain', () => {
    const host = new RangeEmitter();
    host.openNode('string');
    const inner = new RangeEmitter();
    inner.addText('x');
    inner.openNode('params');
    inner.addText('y');
    inner.closeNode();
    host.addText('"');
    host.__addSublanguage(inner, 'foo');
    host.addText('"');
    host.closeNode();
    host.finalize();
    expect(host.spans(undefined)).toEqual(new Map([['constant', [0, 4]]]));
  });

  it('auto-detects and still yields ranges', () => {
    const content = 'def greet(name):\n    return "hi " + name\n';
    const result = highlightContent(content);
    expect(result.language).toBe('python');
    expect(covered(content, result.highlighted.spans).keyword).toContain('def');
  });

  it('rejects runs that do not add up to the content', () => {
    const e = new RangeEmitter();
    e.addText('abc');
    expect(spansFromResult(e, 'abcd', undefined)).toBeNull();
    expect(spansFromResult({}, '', undefined)).toBeNull();
  });

  it('gives plain text no spans', () => {
    expect(highlightContent('a < b', 'txt').highlighted.spans).toEqual(new Map());
  });
});

describe('spansToHtml', () => {
  it('wraps ranges in role spans and escapes all text', () => {
    const spans: TokenSpans = new Map([
      ['keyword', [0, 3]],
      ['constant', [6, 13]],
    ]);
    expect(spansToHtml('let a="<b>&x"; <i>', spans)).toBe(
      '<span class="syn-keyword">let</span> a=<span class="syn-constant">"&lt;b&gt;&amp;x"</span>; &lt;i&gt;'
    );
  });
});
