import { advanceStage, HintStageStore } from '../hint-stage';

describe('advanceStage', () => {
  it('moves from first to learn on timeout or input', () => {
    expect(advanceStage('first', 'timeout')).toBe('learn');
    expect(advanceStage('first', 'input')).toBe('learn');
  });

  it('moves any stage to known when the palette opens', () => {
    expect(advanceStage('first', 'open')).toBe('known');
    expect(advanceStage('learn', 'open')).toBe('known');
    expect(advanceStage('known', 'open')).toBe('known');
  });

  it('never moves backwards', () => {
    expect(advanceStage('learn', 'timeout')).toBe('learn');
    expect(advanceStage('learn', 'input')).toBe('learn');
    expect(advanceStage('known', 'input')).toBe('known');
  });
});

describe('HintStageStore', () => {
  let store: HintStageStore;

  beforeEach(() => {
    localStorage.clear();
    store = new HintStageStore();
  });

  it('starts at first', () => {
    expect(store.load()).toBe('first');
  });

  it('persists advances', () => {
    store.save('learn');
    expect(store.load()).toBe('learn');
    store.save('known');
    expect(store.load()).toBe('known');
  });

  it('refuses to downgrade', () => {
    store.save('known');
    store.save('first');
    expect(store.load()).toBe('known');
  });

  it('treats unknown stored values as first', () => {
    localStorage.setItem('haste-hint-stage', 'bogus');
    expect(store.load()).toBe('first');
  });

  it('falls back to learn when storage is unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(store.load()).toBe('learn');
    spy.mockRestore();
  });
});
