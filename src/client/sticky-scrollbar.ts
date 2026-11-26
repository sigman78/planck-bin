/**
 * StickyScrollbar - the horizontal scrollbar of an element that scrolls
 * sideways on its own but is taller than the window (the viewer pre, the
 * editor textarea), moved to the bottom edge of the window. The element's own
 * scrollbar would sit after the last line, out of reach on a long paste.
 *
 * The bar is a fixed, empty scroller across the window width, with a spacer
 * that gives it the target's scroll range; the two scroll positions are kept
 * in step both ways. While lines overflow, the target gets bottom padding
 * for the bar, so the last line is not under it. The target's own horizontal scrollbar is hidden (CSS,
 * .has-sticky-scrollbar), so there is only ever one, always at the window
 * edge. The bar shows while the target is on screen and has lines wider than
 * itself. Overlay scrollbars (macOS, mobile) take no room, so there the bar
 * gets a drawn scrollbar instead (.sticky-scrollbar-drawn).
 */

export class StickyScrollbar {
  private readonly bar: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private frame = 0;
  /** Whether this bar set the root's scroll-padding-bottom (two bars share it). */
  private padded = false;
  /** Last measured bar height; the bar measures 0 while hidden. */
  private barHeight = 0;

  constructor(private readonly target: HTMLElement) {
    this.bar = document.createElement('div');
    this.bar.className = 'sticky-scrollbar';
    this.bar.dataset.for = target.id;
    this.bar.setAttribute('aria-hidden', 'true');
    // A scroll container is a tab stop in recent Chrome; keyboard users
    // scroll the target itself.
    this.bar.tabIndex = -1;
    this.bar.hidden = true;
    this.spacer = document.createElement('div');
    this.bar.appendChild(this.spacer);
    document.body.appendChild(this.bar);
    target.classList.add('has-sticky-scrollbar');

    this.bar.addEventListener('scroll', () => this.follow(this.bar, this.target), {
      passive: true,
    });
    target.addEventListener('scroll', () => this.follow(target, this.bar), { passive: true });

    const schedule = () => this.schedule();
    // Capture: also catches scrolling ancestors other than the window.
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
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

  /** Re-measure after a change no observer sees (a script setting a textarea's value). */
  refresh(): void {
    this.schedule();
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
    const needed = t.getClientRects().length > 0 && t.scrollWidth - t.clientWidth > 1;
    const rect = needed ? t.getBoundingClientRect() : null;
    const onScreen = rect !== null && rect.top < window.innerHeight && rect.bottom > 0;

    this.bar.hidden = !onScreen;
    if (onScreen) {
      // Full window width, up to the page's vertical scrollbar, like the
      // page's own horizontal one would be; the scroll range is the target's.
      const width = document.documentElement.clientWidth;
      this.bar.style.width = `${width}px`;
      this.spacer.style.width = `${width + t.scrollWidth - t.clientWidth}px`;
      const overlay = this.bar.offsetHeight - this.bar.clientHeight === 0;
      if (overlay) this.bar.classList.add('sticky-scrollbar-drawn');
      this.follow(t, this.bar);
    }
    // Room under the last line for the bar, as the hidden native scrollbar
    // took. Set while the lines overflow, not only while on screen, so the
    // height does not change with page scrolling.
    const room = needed ? this.bar.offsetHeight || this.barHeight : 0;
    if (room) this.barHeight = room;
    t.style.paddingBottom = room ? `${room}px` : '';
    // Keep the caret or a scrolled-to line out from under the bar.
    this.setPadding(onScreen ? this.bar.offsetHeight : null);
  }

  private setPadding(px: number | null): void {
    const root = document.documentElement.style;
    if (px !== null) {
      root.scrollPaddingBottom = `${px}px`;
      this.padded = true;
    } else if (this.padded) {
      root.scrollPaddingBottom = '';
      this.padded = false;
    }
  }
}
