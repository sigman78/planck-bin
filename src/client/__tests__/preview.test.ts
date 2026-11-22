import { findPreviewMode, renderPreview, MAX_PREVIEW_CHARS } from '../preview';
import { sanitizeHtml } from '../preview/sanitize';
import { markdownRenderer } from '../preview/markdown';

/** Rendered markdown as the page would get it: rendered, then sanitized. */
async function preview(markdown: string): Promise<HTMLElement> {
  const mode = findPreviewMode('markdown', markdown)!;
  const host = document.createElement('div');
  host.appendChild(await renderPreview(mode, markdown));
  return host;
}

function sanitized(html: string): HTMLElement {
  const host = document.createElement('div');
  host.appendChild(sanitizeHtml(html));
  return host;
}

describe('findPreviewMode', () => {
  it('offers markdown for markdown only', () => {
    expect(findPreviewMode('markdown', '# x')?.id).toBe('markdown');
    expect(findPreviewMode(undefined, '# x')).toBeNull();
    expect(findPreviewMode('json', '{}')).toBeNull();
  });
});

describe('markdown preview', () => {
  it('renders CommonMark and GFM: headings, emphasis, tables, strikethrough, autolinks', async () => {
    const el = await preview(
      '# Title\n\n*em* **strong** ~~gone~~ https://example.com\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    );
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('em')?.textContent).toBe('em');
    expect(el.querySelector('strong')?.textContent).toBe('strong');
    expect(el.querySelector('s')?.textContent).toBe('gone');
    expect(el.querySelectorAll('td')).toHaveLength(2);
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('keeps table alignment and list numbering', async () => {
    const el = await preview('3. three\n4. four\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n');
    expect(el.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(Array.from(el.querySelectorAll('td'), (td) => td.className)).toEqual([
      'md-align-center',
      'md-align-right',
    ]);
    expect(el.querySelector('[style]')).toBeNull();
  });

  it('renders task lists as disabled checkboxes', async () => {
    const el = await preview('- [x] done\n- [ ] todo\n');
    const boxes = el.querySelectorAll<HTMLInputElement>('input');
    expect(boxes).toHaveLength(2);
    expect(Array.from(boxes, (b) => [b.type, b.disabled, b.checked])).toEqual([
      ['checkbox', true, true],
      ['checkbox', true, false],
    ]);
    expect(el.querySelector('li')?.className).toBe('task-list-item');
  });

  it('escapes raw HTML in the paste', async () => {
    const el = await preview(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> <b>bold</b>'
    );
    expect(el.querySelector('script, img, b')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('turns images into links with their alt text', async () => {
    const el = await preview('![a cat](https://example.com/cat.png)');
    expect(el.querySelector('img')).toBeNull();
    const link = el.querySelector('a.md-image')!;
    expect(link.textContent).toBe('a cat');
    expect(link.getAttribute('href')).toBe('https://example.com/cat.png');
  });

  it('keeps the outer link for an image inside a link', async () => {
    const el = await preview('[![badge](https://img.example/b.svg)](https://example.com/go)');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com/go');
    expect(links[0].textContent).toBe('badge');
  });

  it('never links to script URLs', async () => {
    const el = await preview(
      '[x](javascript:alert(1)) [y](JAVASCRIPT:alert(1)) [z](data:text/html,hi)'
    );
    expect(el.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('opens links in a new tab without referrer', async () => {
    const link = (await preview('[site](https://example.com)')).querySelector('a')!;
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('refuses content over the size cap', async () => {
    const mode = findPreviewMode('markdown', '')!;
    await expect(renderPreview(mode, 'x'.repeat(MAX_PREVIEW_CHARS + 1))).rejects.toThrow(
      'Too large to preview'
    );
  });

  it('returns a fresh copy each time (cached rendering)', async () => {
    const mode = findPreviewMode('markdown', '')!;
    const a = await renderPreview(mode, '# same');
    const b = await renderPreview(mode, '# same');
    expect(a).not.toBe(b);
    expect(a.firstElementChild?.outerHTML).toBe(b.firstElementChild?.outerHTML);
  });

  it('copes with deep nesting', () => {
    expect(() => markdownRenderer.render('>'.repeat(5000) + ' deep')).not.toThrow();
    expect(() => markdownRenderer.render('- '.repeat(2000) + 'x')).not.toThrow();
  });
});

describe('sanitizeHtml', () => {
  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror="alert(1)">', 'img'],
    ['<iframe src="https://example.com"></iframe>', 'iframe'],
    ['<form action="https://evil"><button>go</button></form>', 'form, button'],
    ['<style>body{display:none}</style>', 'style'],
    ['<svg><script>alert(1)</script></svg>', 'svg, script'],
  ])('drops %s', (html, selector) => {
    expect(sanitized(html).querySelector(selector)).toBeNull();
  });

  it('drops event handlers, styles, ids and names', () => {
    const el = sanitized(
      '<p onclick="alert(1)" style="color:red" id="island" name="x">hi</p><a name="location">a</a>'
    );
    const p = el.querySelector('p')!;
    expect(p.getAttributeNames()).toEqual([]);
    expect(el.querySelector('[id], [name]')).toBeNull();
  });

  it('keeps only http(s) and mailto links', () => {
    const el = sanitized(
      '<a href="https://a">1</a><a href="mailto:x@y">2</a><a href="javascript:alert(1)">3</a>' +
        '<a href="/relative">4</a><a href="#frag">5</a><a href="vbscript:x">6</a>'
    );
    expect(Array.from(el.querySelectorAll('a[href]'), (a) => a.getAttribute('href'))).toEqual([
      'https://a',
      'mailto:x@y',
    ]);
  });

  it('keeps only the class names renderers emit', () => {
    const el = sanitized(
      '<li class="task-list-item island-save hidden">x</li><code class="language-js x">y</code>'
    );
    expect(el.querySelector('li')?.className).toBe('task-list-item');
    expect(el.querySelector('code')?.className).toBe('language-js');
  });

  it('turns any input into a disabled checkbox', () => {
    const input = sanitized('<input type="text" value="x">').querySelector('input');
    if (input) {
      expect(input.type).toBe('checkbox');
      expect(input.disabled).toBe(true);
    }
  });
});
