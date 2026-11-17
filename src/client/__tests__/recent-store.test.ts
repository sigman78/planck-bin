import { RecentStore, RECENT_LIMIT } from '../recent-store';

describe('RecentStore', () => {
  let store: RecentStore;

  beforeEach(() => {
    localStorage.clear();
    store = new RecentStore();
  });

  it('starts empty', () => {
    expect(store.list()).toEqual([]);
  });

  it('records a preview from the first non-blank line', () => {
    store.record('abc', '/abc.js', '\n\n   const x = 1;  \nmore', 100);
    expect(store.list()).toEqual([
      { key: 'abc', path: '/abc.js', preview: 'const x = 1;', at: 100 },
    ]);
  });

  it('truncates long previews and falls back to the key for blank content', () => {
    store.record('long', '/long', 'y'.repeat(200), 1);
    store.record('blank', '/blank', '   \n  ', 2);
    const [blank, long] = store.list();
    expect(long.preview).toHaveLength(60);
    expect(blank.preview).toBe('blank');
  });

  it('lists newest first and moves a re-recorded key to the front', () => {
    store.record('a', '/a', 'A', 1);
    store.record('b', '/b', 'B', 2);
    store.record('a', '/a.py', 'A again', 3);
    expect(store.list().map((e) => [e.key, e.path])).toEqual([
      ['a', '/a.py'],
      ['b', '/b'],
    ]);
  });

  it('caps the list', () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i++) store.record(`k${i}`, `/k${i}`, 'x', i);
    const list = store.list();
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].key).toBe(`k${RECENT_LIMIT + 4}`);
  });

  it('removes and clears entries', () => {
    store.record('a', '/a', 'A', 1);
    store.record('b', '/b', 'B', 2);
    store.remove('a');
    expect(store.list().map((e) => e.key)).toEqual(['b']);
    store.clear();
    expect(store.list()).toEqual([]);
  });

  it('ignores corrupt or malformed stored data', () => {
    localStorage.setItem('haste-recent', '{not json');
    expect(store.list()).toEqual([]);
    localStorage.setItem('haste-recent', JSON.stringify([{ key: 1 }, 'x', null]));
    expect(store.list()).toEqual([]);
  });

  it('degrades to a no-op when storage throws', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => store.record('a', '/a', 'A')).not.toThrow();
    expect(store.list()).toEqual([]);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
