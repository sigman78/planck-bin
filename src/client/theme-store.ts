/**
 * The color theme picked in the palette ("Theme"), remembered per browser.
 * null = the default theme. Best-effort: without storage the choice lasts
 * for the tab only.
 */

import { DEFAULT_THEME, isThemeId } from './themes';

const THEME_KEY = 'haste-theme';

export class ThemeStore {
  load(): string | null {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return isThemeId(stored) && stored !== DEFAULT_THEME ? stored : null;
    } catch {
      return null;
    }
  }

  save(theme: string): void {
    try {
      if (theme === DEFAULT_THEME) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // best-effort
    }
  }
}
