import { highlightContent } from '../highlight-config';
import { extractSpans, type TokenSpans } from '../syntax-highlights';

/** Text covered by each role, in order. */
function covered(content: string, spans: TokenSpans | null): Record<string, string[]> {
  expect(spans).not.toBeNull();
  const out: Record<string, string[]> = {};
  for (const [role, offsets] of spans!) {
    out[role] = [];
    for (let i = 0; i < offsets.length; i += 2) {
      out[role].push(content.slice(offsets[i], offsets[i + 1]));
    }
  }
  return out;
}

describe('extractSpans', () => {
  it('maps hljs tokens to theme roles with exact offsets', () => {
    const content = 'const x = "hi"; // note\nfunction f(a) { return 42; }';
    const { highlighted } = highlightContent(content, 'javascript');
    const roles = covered(content, highlighted.spans);

    expect(roles.keyword).toEqual(expect.arrayContaining(['const', 'function', 'return']));
    expect(roles.constant).toEqual(expect.arrayContaining(['"hi"', '42']));
    expect(roles.comment).toEqual(['// note']);
    expect(roles.definition).toEqual(['f']);
    // params scope is unstyled: "a" stays base text
    expect(Object.values(roles).flat()).not.toContain('a');
  });

  it('keeps offsets aligned across CRLF and sublanguages', () => {
    const content = '<p>\r\n<script>let a = 1;</script>\r\n</p>';
    const { highlighted } = highlightContent(content, 'xml');
    const roles = covered(content, highlighted.spans);
    // "<script>" and "let" are both keyword-colored and adjacent, so merged.
    expect(roles.keyword).toEqual(['<p>', '<script>let', '</script>', '</p>']);
    expect(roles.constant).toEqual(['1']);
  });

  it('applies contextual roles (keyword inside meta, diff meta)', () => {
    const cpp = '#include <stdio.h>\nint main() {}';
    const cppRoles = covered(cpp, highlightContent(cpp, 'cpp').highlighted.spans);
    expect(cppRoles.special?.join('')).toContain('include');

    const diff = '@@ -1 +1 @@\n-a\n+b';
    const diffRoles = covered(diff, highlightContent(diff, 'diff').highlighted.spans);
    expect(diffRoles.diff).toEqual(['@@ -1 +1 @@']);
    expect(diffRoles.deletion).toEqual(['-a']);
    expect(diffRoles.addition).toEqual(['+b']);
  });

  it('merges contiguous ranges of the same role', () => {
    const root = {
      children: [
        { scope: 'string', children: ['"a'] },
        { scope: 'string', children: ['b"'] },
      ],
    };
    expect(extractSpans(root, '"ab"', undefined)).toEqual(new Map([['constant', [0, 4]]]));
  });

  it('returns null when the tree text does not match the content', () => {
    expect(extractSpans({ children: ['abc'] }, 'abcd', undefined)).toBeNull();
    expect(extractSpans(undefined, '', undefined)).toBeNull();
  });

  it('gives plain text no spans', () => {
    expect(highlightContent('a < b', 'txt').highlighted.spans).toEqual(new Map());
  });
});
