import { parseQuery, fuzzyScore, rankItems } from '../palette-search';

describe('parseQuery', () => {
  it('parses a go-to-line query', () => {
    expect(parseQuery(':12')).toEqual({ kind: 'line', line: 12 });
    expect(parseQuery(' :7 ')).toEqual({ kind: 'line', line: 7 });
  });

  it('returns a null line for incomplete or invalid numbers', () => {
    expect(parseQuery(':')).toEqual({ kind: 'line', line: null });
    expect(parseQuery(':x')).toEqual({ kind: 'line', line: null });
    expect(parseQuery(':0')).toEqual({ kind: 'line', line: null });
    expect(parseQuery(':1.5')).toEqual({ kind: 'line', line: null });
  });

  it('parses a find query, keeping inner whitespace', () => {
    expect(parseQuery('/foo')).toEqual({ kind: 'find', text: 'foo' });
    expect(parseQuery('/a b')).toEqual({ kind: 'find', text: 'a b' });
    expect(parseQuery('/')).toEqual({ kind: 'find', text: '' });
  });

  it('treats anything else as a trimmed filter', () => {
    expect(parseQuery('  sav ')).toEqual({ kind: 'filter', text: 'sav' });
    expect(parseQuery('')).toEqual({ kind: 'filter', text: '' });
  });
});

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'Save')).toBeNull();
    expect(fuzzyScore('evas', 'Save')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('SAVE', 'save')).not.toBeNull();
  });

  it('ranks prefix above word-start above scattered matches', () => {
    const prefix = fuzzyScore('co', 'Copy link')!;
    const wordStart = fuzzyScore('li', 'Copy link')!;
    const scattered = fuzzyScore('cy', 'Copy link')!;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(scattered);
  });

  it('prefers consecutive characters over gapped ones', () => {
    expect(fuzzyScore('new', 'New paste')!).toBeGreaterThan(fuzzyScore('npe', 'New paste')!);
  });

  it('gives an exact match the highest score', () => {
    expect(fuzzyScore('save', 'Save')!).toBeGreaterThan(fuzzyScore('save', 'Saved items')!);
  });
});

describe('rankItems', () => {
  const items = [
    { label: 'Save', keywords: [] as string[] },
    { label: 'New paste', keywords: ['clear'] },
    { label: 'Copy link', keywords: ['share', 'url'] },
    { label: 'View raw', keywords: [] as string[] },
  ];
  const texts = (i: (typeof items)[number]) => [i.label, ...i.keywords];

  it('keeps the original order for an empty query', () => {
    expect(rankItems(items, '', texts)).toEqual(items);
  });

  it('drops non-matching items', () => {
    expect(rankItems(items, 'raw', texts).map((i) => i.label)).toEqual(['View raw']);
  });

  it('matches on keywords', () => {
    expect(rankItems(items, 'share', texts).map((i) => i.label)).toEqual(['Copy link']);
  });

  it('puts the best match first', () => {
    expect(rankItems(items, 'n', texts)[0].label).toBe('New paste');
  });

  it('is stable among equal scores', () => {
    const same = [
      { label: 'Alpha', keywords: [] as string[] },
      { label: 'Alpha', keywords: [] as string[] },
    ];
    const ranked = rankItems(same, 'al', texts);
    expect(ranked[0]).toBe(same[0]);
    expect(ranked[1]).toBe(same[1]);
  });
});
