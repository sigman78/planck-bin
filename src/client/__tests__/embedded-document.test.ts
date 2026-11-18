import { EMBEDDED_DOCUMENT_ID } from '../../shared/types';

/** Fresh module per test: the module caches what it read from the DOM. */
function load(payload: unknown) {
  document.body.innerHTML = '';
  if (payload !== undefined) {
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = EMBEDDED_DOCUMENT_ID;
    el.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload);
    document.body.appendChild(el);
  }
  jest.resetModules();
  return jest.requireActual<typeof import('../embedded-document')>('../embedded-document');
}

describe('embedded document', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('hands over the document once, for its own key', () => {
    const m = load({ key: 'abc', content: 'hi' });
    expect(m.hasEmbeddedDocument('abc')).toBe(true);
    expect(m.hasEmbeddedDocument('other')).toBe(false);
    expect(m.takeEmbeddedDocument('abc')).toEqual({ key: 'abc', content: 'hi' });
    expect(m.takeEmbeddedDocument('abc')).toBeNull();
    expect(document.getElementById(EMBEDDED_DOCUMENT_ID)).toBeNull();
  });

  it('reports a not-found marker, which is not a document to show', () => {
    const m = load({ key: 'gone', notFound: true });
    expect(m.hasEmbeddedDocument('gone')).toBe(false);
    expect(m.takeEmbeddedDocument('gone')).toBe('not-found');
    expect(m.takeEmbeddedDocument('gone')).toBeNull();
  });

  it('ignores a marker for another key', () => {
    const m = load({ key: 'gone', notFound: true });
    expect(m.takeEmbeddedDocument('abc')).toBeNull();
  });

  it.each([
    ['nothing embedded', undefined],
    ['malformed JSON', '{nope'],
    ['no content and no marker', { key: 'abc' }],
    ['a marker that is not exactly true', { key: 'abc', notFound: 'yes' }],
  ])('treats %s as no embedded document', (_name, payload) => {
    const m = load(payload);
    expect(m.hasEmbeddedDocument('abc')).toBe(false);
    expect(m.takeEmbeddedDocument('abc')).toBeNull();
  });
});
