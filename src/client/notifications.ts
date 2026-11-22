/**
 * Notifications - toast messages and the save progress bar.
 *
 * Extracted from ViewManager so transient UI feedback is independent
 * of editor/viewer rendering.
 */

export type ToastKind = 'info' | 'error';

const TOAST_DURATION_MS = 4000;
const BRIEF_DURATION_MS = 1200;
/** Errors wrap more often and need reading time. */
const ERROR_DURATION_MS = 6000;

export interface ToastOptions {
  /** Short-lived status (e.g. the zoom level); same look, shorter duration. */
  brief?: boolean;
}

export class Notifications {
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every toast, so a deferred re-announce never overwrites a newer message. */
  private toastSeq = 0;

  toast(message: string, kind: ToastKind = 'info', options: ToastOptions = {}): void {
    const toast = document.getElementById('toast')!;
    // Errors interrupt the screen reader; everything else waits its turn.
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    if (toast.textContent === message) {
      // An unchanged text is not announced again: clear it, then set it on the next frame.
      toast.textContent = '';
      const seq = ++this.toastSeq;
      requestAnimationFrame(() => {
        if (seq === this.toastSeq) toast.textContent = message;
      });
    } else {
      this.toastSeq++;
      toast.textContent = message;
    }
    toast.classList.toggle('error', kind === 'error');
    toast.classList.add('visible');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => {
        toast.classList.remove('visible');
        this.toastTimer = null;
      },
      kind === 'error' ? ERROR_DURATION_MS : options.brief ? BRIEF_DURATION_MS : TOAST_DURATION_MS
    );
  }

  /** Hide the toast now, e.g. an error the user has just resolved. */
  dismiss(): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toastSeq++; // cancels a deferred re-announce
    document.getElementById('toast')!.classList.remove('visible');
  }

  progressStart(): void {
    const bar = document.getElementById('progress-bar')!;
    bar.classList.remove('done', 'clear');
    bar.getBoundingClientRect();
    bar.classList.add('running');
  }

  progressDone(): void {
    const bar = document.getElementById('progress-bar')!;
    bar.classList.remove('running');
    bar.classList.add('done');

    setTimeout(() => {
      bar.classList.remove('done');
      bar.classList.add('clear');
    }, 500);
  }
}
