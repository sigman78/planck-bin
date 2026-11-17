import { findOffsets } from '../viewer-find';

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
