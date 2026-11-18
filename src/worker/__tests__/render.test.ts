import { EMBEDDED_DOCUMENT_ID, type GetResponse } from '../../shared/types';
import { renderDocumentPage, VIEWER_ANCHOR } from '../render';

// Jest runs this under node; the worker tsconfig has no node types, so declare the two used.
declare const require: (id: string) => { readFileSync(path: string, enc: string): string };
declare const __dirname: string;

// The source shell; the built one keeps the same anchors (checked on build).
const SHELL = require('node:fs').readFileSync(`${__dirname}/../../client/index.html`, 'utf8');

const NASTY = [
  'const s = "</script><script>alert(1)</script>";',
  '<!-- not a comment --> <b>bold?</b> &amp; &lt;',
  "replace('x', '$&') + `$'` + \"$`\" + '$$'",
  'line\r\nwith CRLF\rand CR',
  'separators: \u2028 \u2029 and nul-free',
  'quotes " \' and a lone >',
].join('\n');

function render(doc: GetResponse, displayName = `${doc.key}.js`) {
  return renderDocumentPage(SHELL, { appName: 'Planck Bin', displayName, doc });
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('renderDocumentPage', () => {
  it('finds every anchor in the shell exactly once', () => {
    expect(SHELL.split(VIEWER_ANCHOR)).toHaveLength(2);
    expect(render({ key: 'k', content: 'x' })).not.toBeNull();
  });

  it('round-trips hostile content exactly through the embedded JSON', () => {
    const doc: GetResponse = {
      key: 'tavelu-hasoq',
      content: NASTY,
      createdAt: '2026-11-17T00:00:00.000Z',
      expiresAt: null,
    };
    const dom = parse(render(doc)!);

    const scripts = dom.querySelectorAll('script');
    const data = dom.getElementById(EMBEDDED_DOCUMENT_ID)!;
    expect(data.getAttribute('type')).toBe('application/json');
    expect(JSON.parse(data.textContent!)).toEqual(doc);
    // Nothing escaped the data element: only the shell's module script plus ours.
    expect(scripts).toHaveLength(2);
  });

  it('paints the text into the visible viewer (CR normalized by the parser)', () => {
    const dom = parse(render({ key: 'k', content: NASTY })!);
    const viewer = dom.getElementById('viewer')!;
    expect(viewer.style.display).toBe('block');
    expect(viewer.querySelector('code')!.textContent).toBe(NASTY.replace(/\r\n?/g, '\n'));
    expect(viewer.querySelectorAll('b')).toHaveLength(0);
  });

  it('keeps a leading newline (it sits after <code>, not <pre>)', () => {
    const dom = parse(render({ key: 'k', content: '\nfirst' })!);
    expect(dom.querySelector('#viewer code')!.textContent).toBe('\nfirst');
  });

  it('sets the title like the client and an escaped preview title', () => {
    const dom = parse(render({ key: 'k', content: 'x' }, 'k.c"><script>')!);
    expect(dom.title).toBe('Planck Bin - k');
    expect(dom.querySelector('meta[property="og:title"]')!.getAttribute('content')).toBe(
      'k.c"><script>'
    );
  });

  it('gives up (plain shell) when an anchor is missing or repeated', () => {
    const doc = { key: 'k', content: 'x' };
    const opts = { appName: 'Planck Bin', displayName: 'k', doc };
    expect(renderDocumentPage(SHELL.replace(VIEWER_ANCHOR, ''), opts)).toBeNull();
    expect(renderDocumentPage(SHELL + '</body>', opts)).toBeNull();
    expect(renderDocumentPage(SHELL.replace('<title>', ''), opts)).toBeNull();
  });
});
