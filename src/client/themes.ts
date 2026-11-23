/**
 * Color themes: the registry behind the palette's Theme menu. Each non-default
 * id has an html[data-theme="id"] block in themes.css; the default is the
 * tokens.css :root (Solarized Dark) and sets no attribute.
 */

export interface ThemeInfo {
  id: string;
  label: string;
  scheme: 'dark' | 'light';
}

export const DEFAULT_THEME = 'solarized-dark';

export const THEMES: readonly ThemeInfo[] = [
  { id: 'solarized-dark', label: 'Solarized Dark', scheme: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', scheme: 'light' },
  { id: 'github', label: 'GitHub', scheme: 'light' },
  { id: 'atom-one-dark', label: 'Atom One Dark', scheme: 'dark' },
  { id: 'monokai', label: 'Monokai', scheme: 'dark' },
];

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEMES.some((t) => t.id === value);
}

export function themeLabel(id: string): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

/**
 * Paint in a theme: set or clear data-theme on <html> (the page), or on a
 * .theme-scope element, which then keeps its own theme whatever the page shows.
 */
export function applyTheme(id: string, root: HTMLElement = document.documentElement): void {
  if (id === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = id;
}
