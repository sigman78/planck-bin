import { ThemeStore } from '../theme-store';
import { DEFAULT_THEME, applyTheme } from '../themes';

describe('ThemeStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a theme', () => {
    const store = new ThemeStore();
    store.save('monokai');
    expect(store.load()).toBe('monokai');
    expect(localStorage.getItem('haste-theme')).toBe('monokai');
  });

  it('stores the default as no entry', () => {
    const store = new ThemeStore();
    store.save('github');
    store.save(DEFAULT_THEME);
    expect(localStorage.getItem('haste-theme')).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('ignores unknown ids', () => {
    localStorage.setItem('haste-theme', 'neon-pink');
    expect(new ThemeStore().load()).toBeNull();
  });

  it('survives storage that throws', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const store = new ThemeStore();
    expect(store.load()).toBeNull();
    expect(() => store.save('github')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('applyTheme', () => {
  it('sets data-theme on <html>, and clears it for the default', () => {
    const root = document.documentElement;
    applyTheme('github');
    expect(root.dataset.theme).toBe('github');
    applyTheme(DEFAULT_THEME);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
