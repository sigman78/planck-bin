import hljs, {
  getLanguageForExtension,
  highlightContent,
  listLanguages,
  resolveLanguage,
  MAX_AUTO_HIGHLIGHT_LENGTH,
  MAX_EXPLICIT_HIGHLIGHT_LENGTH,
} from '../highlight-config';

describe('highlight policy', () => {
  it('treats unknown extensions as unknown rather than throwing', () => {
    expect(getLanguageForExtension('xyz-not-registered')).toBeUndefined();
    expect(getLanguageForExtension('__proto__')).toBeUndefined();
  });

  it('leaves content too large for automatic detection unhighlighted', () => {
    const content = '<script>alert(1)</script>' + 'x'.repeat(MAX_AUTO_HIGHLIGHT_LENGTH);
    const result = highlightContent(content);

    expect(result.highlighted.runs).toBeNull();
    expect(result.language).toBeUndefined();
  });

  it('bounds explicit highlighting independently', () => {
    const content = '<img onerror=alert(1)>' + 'x'.repeat(MAX_EXPLICIT_HIGHLIGHT_LENGTH);
    const result = highlightContent(content, 'xml');

    expect(result.highlighted.runs).toBeNull();
    expect(result.language).toBe('xml');
  });
});

describe('listLanguages', () => {
  const languages = listLanguages();

  it('starts with plain text', () => {
    expect(languages[0]).toEqual({ id: '', name: 'Plain text', ext: 'txt' });
  });

  it('lists each display name once', () => {
    const names = languages.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n === 'JavaScript')).toHaveLength(1);
  });

  it('only lists registered languages', () => {
    for (const lang of languages.slice(1)) {
      expect(hljs.getLanguage(lang.id)).toBeDefined();
    }
  });

  it('round-trips every language through its URL extension', () => {
    for (const lang of languages) {
      expect(resolveLanguage(lang.ext)).toBe(lang.id);
    }
  });
});

describe('resolveLanguage', () => {
  it('prefers the extension map, then registered language names', () => {
    expect(resolveLanguage('py')).toBe('python');
    expect(resolveLanguage('txt')).toBe('');
    expect(resolveLanguage('shell')).toBe('shell');
    expect(resolveLanguage('nope')).toBeUndefined();
  });
});
