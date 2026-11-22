/**
 * Print listing: a paper-friendly copy of the paste, built just before the
 * browser prints and removed after.
 *
 * The screen view cannot print well: the gutter is a separate column next to
 * one text node, so wrapping long lines would misalign the numbers. The
 * listing puts each line in its own row (number + text), so wrapped lines keep
 * their number. It prints as plain black text: no syntax colors on paper.
 */

export interface PrintSource {
  /** Text as shown (LF line endings). */
  text: string;
  /** Number the lines (the lineNumbers option). */
  numbers: boolean;
  /** A rendered preview on screen: printed as that document instead of a listing. */
  rendered?: HTMLElement;
}

const LISTING_ID = 'print-listing';
const PAGE_STYLE_ID = 'print-page';

/** CSS string literal for generated content. */
const cssString = (value: string) => `"${value.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;

export class PrintListing {
  constructor(private readonly source: () => PrintSource | null) {
    window.addEventListener('beforeprint', () => this.build());
    window.addEventListener('afterprint', () => this.teardown());
  }

  /** Build the listing and the page header/footer for the current paste. */
  build(): void {
    this.teardown();
    const src = this.source();
    if (!src) return;
    if (src.rendered) {
      this.buildDocument(src.rendered);
      return;
    }

    const lines = src.text.split('\n');
    const listing = document.createElement('div');
    listing.id = LISTING_ID;
    listing.setAttribute('aria-hidden', 'true');
    if (!src.numbers) listing.classList.add('no-numbers');
    listing.style.setProperty('--print-digits', String(String(lines.length).length));

    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      const row = document.createElement('div');
      row.className = 'pl-row';
      const num = document.createElement('span');
      num.className = 'pl-num';
      num.textContent = String(i + 1);
      const code = document.createElement('span');
      code.className = 'pl-code';
      code.textContent = line;
      row.appendChild(num);
      row.appendChild(code);
      frag.appendChild(row);
    });
    listing.appendChild(frag);
    document.body.appendChild(listing);

    this.setPageBoxes(lines.length);
  }

  /** The rendered preview, copied as is; its own print rules make it black on white. */
  private buildDocument(rendered: HTMLElement): void {
    const doc = document.createElement('div');
    doc.id = LISTING_ID;
    doc.className = 'markdown-body';
    doc.setAttribute('aria-hidden', 'true');
    for (const node of Array.from(rendered.childNodes)) doc.appendChild(node.cloneNode(true));
    document.body.appendChild(doc);
    this.setPageBoxes(null);
  }

  teardown(): void {
    document.getElementById(LISTING_ID)?.remove();
    document.getElementById(PAGE_STYLE_ID)?.remove();
  }

  /** Running header (address, line count) and page numbers in the page margins. */
  private setPageBoxes(lineCount: number | null): void {
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    const where = `${location.host}${location.pathname === '/' ? '' : location.pathname}`;
    // A rendered document has no lines to count.
    const count = lineCount === null ? '' : `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
    style.textContent =
      `@page { @top-left { content: ${cssString(where)}; } ` +
      `@top-right { content: ${cssString(count)}; } }`;
    document.head.appendChild(style);
  }
}
