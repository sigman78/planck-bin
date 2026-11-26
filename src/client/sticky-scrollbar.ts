/**
 * StickyScrollbar - a horizontal scrollbar pinned to the bottom of the window
 * for an element that scrolls sideways on its own but is taller than the
 * window (the viewer pre, the editor textarea). Its own scrollbar sits after
 * the last line, out of reach on a long paste; this bar stands in for it.
 *
 * The bar is a fixed, empty scroller with a spacer as wide as the target's
 * content, laid over the target's columns. The two scroll positions are kept
 * in step both ways. The bar shows only while the target is displayed, has
 * lines wider than itself, and its own scrollbar is below the window edge.
 */

export class StickyScrollbar {
  private readonly bar: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private frame = 0;

  constructor(private readonly target: HTMLElement) {
    this.bar = document.createElement('div');
    this.bar.className = 'sticky-scrollbar';
    this.bar.setAttribute('aria-hidden', 'true');
    this.bar.hidden = true;
    this.spacer = document.createElement('div');
    this.bar.appendChild(this.spacer);
    document.body.appendChild(this.bar);

    this.bar.addEventListener('scroll', () => this.follow(this.bar, this.target), {
      passive: true,
    });
    target.addEventListener('scroll', () => this.follow(target, this.bar), { passive: true });

    const schedule = () => this.schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Display toggles, zoom and line-count changes resize the target; a
    // longer line with the same line count only changes its content.
    new ResizeObserver(schedule).observe(target);
    new MutationObserver(schedule).observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    target.addEventListener('input', schedule);
    // Preview mode hides the target through a class on an ancestor.
    if (target.parentElement) {
      new MutationObserver(schedule).observe(target.parentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  private follow(from: HTMLElement, to: HTMLElement): void {
    if (Math.abs(to.scrollLeft - from.scrollLeft) >= 1) to.scrollLeft = from.scrollLeft;
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update(): void {
    const t = this.target;
    const shown = t.getClientRects().length > 0;
    const rect = t.getBoundingClientRect();
    const overflows = t.scrollWidth - t.clientWidth > 1;
    const viewportBottom = window.innerHeight;
    const needed = shown && overflows && rect.bottom > viewportBottom && rect.top < viewportBottom;

    this.bar.hidden = !needed;
    if (!needed) return;
    this.bar.style.left = `${rect.left + t.clientLeft}px`;
    this.bar.style.width = `${t.clientWidth}px`;
    this.spacer.style.width = `${t.scrollWidth}px`;
    this.follow(t, this.bar);
  }
}
