import { findOffsets, ViewerFind } from '../viewer-find';

describe('findOffsets', () => {
  it('returns no matches for an empty query', () => {
    expect(findOffsets('anything', '')).toEqual([]);
  });

  it('finds every occurrence', () => {
    expect(findOffsets('foo bar foo baz foo', 'foo')).toEqual([0, 8, 16]);
  });

  it('is case-insensitive', () => {
    expect(findOffsets('Foo FOO foo', 'foo')).toEqual([0, 4, 8]);
  });

  it('does not report overlapping matches', () => {
    expect(findOffsets('aaa', 'aa')).toEqual([0]);
    expect(findOffsets('aaaa', 'aa')).toEqual([0, 2]);
  });

  it('honours the match limit', () => {
    expect(findOffsets('x'.repeat(50), 'x', 10)).toHaveLength(10);
  });

  it('matches across lines', () => {
    expect(findOffsets('a\nb', 'a\nb')).toEqual([0]);
  });
});

describe('ViewerFind without the Highlight API', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
    window.scrollTo = () => {};
  });

  function setup(text: string) {
    document.body.innerHTML = '<pre><code></code></pre>';
    const code = document.querySelector('code')!;
    code.textContent = text;
    return new ViewerFind(code);
  }

  it('selects the current match', () => {
    const find = setup('foo bar foo');
    expect(find.search('foo')).toEqual({ current: 1, total: 2 });
    let range = window.getSelection()!.getRangeAt(0);
    expect(range.startOffset).toBe(0);
    find.step(1);
    range = window.getSelection()!.getRangeAt(0);
    expect(range.startOffset).toBe(8);
    expect(range.toString()).toBe('foo');
  });

  it('drops its selection when cleared', () => {
    const find = setup('foo');
    find.search('foo');
    find.clear();
    expect(window.getSelection()!.rangeCount).toBe(0);
  });
});
