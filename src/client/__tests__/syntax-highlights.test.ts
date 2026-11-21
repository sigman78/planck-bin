import hljs, { highlightContent } from '../highlight-config';
import { RangeEmitter, runsFromResult, viewerText, type ScopeNode } from '../syntax-highlights';

/** Scope chain of a run, outermost first ("lang:x" for an embedded root). */
function chain(node: ScopeNode): string {
  const parts: string[] = [];
  for (let n: ScopeNode | null = node; n; n = n.parent) {
    if (n.scope) parts.unshift(n.scope);
    else if (n.language) parts.unshift('lang:' + n.language);
  }
  return parts.join(' > ');
}

/** Text of each run with its scope chain. */
function runs(content: string, language?: string): [string, string][] {
  const r = highlightContent(content, language).highlighted.runs;
  expect(r).not.toBeNull();
  const text = viewerText(content);
  const out: [string, string][] = [];
  // Resolve every run to a unique name to read the runs back in order.
  const spans = r!.spans((node) => chain(node) || null);
  for (const [name, offsets] of spans) {
    for (let i = 0; i < offsets.length; i += 2) {
      out.push([text.slice(offsets[i], offsets[i + 1]), name]);
    }
  }
  return out;
}

describe('RangeEmitter', () => {
  it('is the emitter hljs uses, and produces no HTML', () => {
    const result = hljs.highlight('const x = 1;', { language: 'javascript' });
    expect(result._emitter).toBeInstanceOf(RangeEmitter);
    expect(result.value).toBe('');
  });

  it('records runs with exact offsets and their scope chains', () => {
    const r = runs('const x = "hi"; // note\nfunction f(a) { return 42; }', 'javascript');
    expect(r).toEqual(
      expect.arrayContaining([
        ['const', 'keyword'],
        ['"hi"', 'string'],
        ['// note', 'comment'],
        ['f', 'title.function'],
        ['a', 'params'],
        ['42', 'number'],
      ])
    );
  });

  it('normalizes CRLF and lone CR to LF, like the HTML parser', () => {
    expect(viewerText('a\r\nb\rc\n\r\n')).toBe('a\nb\nc\n\n');
  });

  it('tokenizes the LF text, so offsets match the viewer text node', () => {
    const content = 'let a = 1;\r\n// x\r\nlet b = 2;';
    expect(highlightContent(content, 'javascript').highlighted.runs?.length).toBe(
      content.length - 2
    );
    expect(runs(content, 'javascript')).toEqual(
      expect.arrayContaining([
        ['// x', 'comment'],
        ['2', 'number'],
      ])
    );
  });

  it('keeps offsets aligned across sublanguages', () => {
    const r = runs('<p>\r\n<script>let a = 1;</script>\r\n</p>', 'xml');
    expect(r).toEqual(
      expect.arrayContaining([
        ['let', 'lang:javascript > keyword'],
        ['1', 'lang:javascript > number'],
      ])
    );
  });

  it('reparents embedded runs onto the host scope chain', () => {
    const host = new RangeEmitter();
    host.openNode('string');
    const inner = new RangeEmitter();
    inner.openNode('params');
    inner.addText('y');
    inner.closeNode();
    inner.finalize();
    host.addText('"');
    host.__addSublanguage(inner, 'foo');
    host.addText('"');
    host.closeNode();
    host.finalize();
    const seen: string[] = [];
    host.spans((node) => {
      seen.push(chain(node));
      return null;
    });
    expect(seen).toEqual(['string', 'string > lang:foo > params', 'string']);
  });

  it('auto-detects and still yields runs', () => {
    const content = 'def greet(name):\n    return "hi " + name\n';
    const result = highlightContent(content);
    expect(result.language).toBe('python');
    expect(result.highlighted.runs?.length).toBe(content.length);
  });

  it('rejects runs that do not add up to the content', () => {
    const e = new RangeEmitter();
    e.addText('abc');
    expect(runsFromResult(e, 'abcd')).toBeNull();
    expect(runsFromResult(e, 'abc')).toBe(e);
    expect(runsFromResult({}, '')).toBeNull();
  });

  it('gives plain text no runs', () => {
    expect(highlightContent('a < b', 'txt').highlighted.runs).toBeNull();
  });
});
