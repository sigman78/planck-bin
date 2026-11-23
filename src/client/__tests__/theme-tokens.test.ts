import {
  contrast,
  inSrgb,
  parseTokenBlocks,
  resolveColor,
  themeScope,
  toHex,
} from '../test-support/css-color';
import { DEFAULT_THEME, THEMES } from '../themes';

// Jest runs under Node; the project tsconfig has no Node types.
declare const require: (id: string) => { readFileSync(path: string, enc: string): string };
declare const __dirname: string;

const read = (name: string) => require('node:fs').readFileSync(`${__dirname}/../${name}`, 'utf8');
const themesCss = read('themes.css');
const blocks = parseTokenBlocks(read('tokens.css') + themesCss);

/** Every theme block sets these: surfaces, content colors and tiers. */
const CONTRACT = [
  '--color-bg',
  '--color-island-panel',
  '--color-key-bg',
  '--color-island-bg',
  '--color-island-bg-hover',
  '--color-selection',
  '--color-focus-muted',
  '--color-toast-error-bg',
  '--color-editor-text',
  '--color-placeholder',
  '--color-icon',
  '--color-logo',
  '--color-find',
  '--syntax-src-text',
  '--syntax-l-bright',
  '--syntax-l-accent',
  '--syntax-l-warm',
  '--syntax-l-text',
  '--syntax-l-dim',
  '--syntax-l-addition',
  '--syntax-c-calm',
  '--syntax-c-vivid',
];

/** Minimum WCAG contrast of each syntax role on the theme background. */
const SYNTAX_MIN: Record<string, number> = {
  text: 6.5,
  keyword: 6.5,
  definition: 6.5,
  constant: 6.5,
  special: 5,
  deletion: 5,
  addition: 6,
};

/** UI text on its surface: [fg, bg, minimum]. */
const UI_MIN: [string, string, number][] = [
  ['--color-editor-text', '--color-bg', 4.5],
  ['--color-logo', '--color-bg', 7],
  ['--color-link', '--color-bg', 4],
  ['--color-logo', '--color-island-panel', 7],
  ['--color-toast-text', '--color-island-panel', 4.5],
  ['--color-toast-error-text', '--color-toast-error-bg', 4.5],
  ['--color-on-accent', '--color-accent', 4.5],
  ['--color-editor-text', '--color-island-bg', 3.5],
  ['--color-editor-text', '--color-selection', 3],
];

describe('theme registry and themes.css', () => {
  it('has one block per non-default theme, and no strays', () => {
    const ids = [...blocks.keys()].filter((id) => id !== '').sort();
    expect(ids).toEqual(
      THEMES.map((t) => t.id)
        .filter((id) => id !== DEFAULT_THEME)
        .sort()
    );
  });

  it.each(THEMES.filter((t) => t.id !== DEFAULT_THEME))('$id sets the full contract', (theme) => {
    const decls = blocks.get(theme.id)!;
    expect(CONTRACT.filter((name) => !decls.has(name))).toEqual([]);
  });

  it.each(THEMES.filter((t) => t.id !== DEFAULT_THEME))(
    '$id declares its color-scheme and overlay direction',
    (theme) => {
      const at = themesCss.indexOf(`html[data-theme="${theme.id}"] {`);
      const block = themesCss.slice(at, themesCss.indexOf('}', at));
      if (theme.scheme === 'light') {
        expect(block).toMatch(/color-scheme: light;/);
        expect(blocks.get(theme.id)!.get('--overlay-l')).toBe('0');
      } else {
        expect(block).not.toMatch(/color-scheme: light;/);
        expect(blocks.get(theme.id)!.has('--overlay-l')).toBe(false);
      }
    }
  );
});

describe.each(THEMES)('$label colors', (theme) => {
  const scope = themeScope(blocks, theme.id === DEFAULT_THEME ? '' : theme.id);
  const bg = resolveColor('--syntax-bg', scope);

  it.each(Object.keys(SYNTAX_MIN))('syntax %s stays in sRGB and readable', (role) => {
    const fg = resolveColor(`--syntax-${role}`, scope);
    expect({ role, hex: toHex(fg), inSrgb: inSrgb(fg) }).toEqual({
      role,
      hex: toHex(fg),
      inSrgb: true,
    });
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(SYNTAX_MIN[role]);
  });

  it('dims punctuation on purpose, and comments read on their plate', () => {
    const punctuation = resolveColor('--syntax-punctuation', scope);
    expect(inSrgb(punctuation)).toBe(true);
    expect(contrast(punctuation, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(punctuation, bg)).toBeLessThan(4.5);
    const comment = contrast(
      resolveColor('--syntax-comment', scope),
      resolveColor('--syntax-comment-bg', scope)
    );
    expect(comment).toBeGreaterThanOrEqual(3);
  });

  it.each(UI_MIN)('%s on %s', (fg, surface, min) => {
    expect(contrast(resolveColor(fg, scope), resolveColor(surface, scope))).toBeGreaterThanOrEqual(
      min
    );
  });

  it('matches its declared scheme', () => {
    const bgL = resolveColor('--color-bg', scope).l;
    expect(theme.scheme === 'light' ? bgL > 0.6 : bgL < 0.4).toBe(true);
  });
});

describe('Solarized Dark (default) syntax ladder', () => {
  // Pins the tuning recorded in tokens.css comments.
  const scope = themeScope(blocks, '');
  const bg = resolveColor('--syntax-bg', scope);
  it.each([
    ['text', 7.0],
    ['punctuation', 3.3],
    ['keyword', 7.5],
    ['definition', 7.6],
    ['constant', 9.6],
    ['special', 5.5],
    ['deletion', 5.4],
    ['addition', 8.3],
  ])('%s is about %s', (role, ratio) => {
    expect(contrast(resolveColor(`--syntax-${role}`, scope), bg)).toBeCloseTo(ratio as number, 1);
  });
});
