/**
 * ViewManager (DOM) - Pure Sync DOM Operations
 *
 * Responsibilities:
 * - Owns specific DOM subtree
 * - Two render modes:
 *   - renderFullState(): Updates everything including editor (for loading/reset)
 *   - renderUIState(): Updates UI except editor (during editing)
 * - Reads: getContentFromDOM()
 * - Event delegation: emits user actions to controller
 * - No business logic
 */

import type { Paste } from './paste';
import { ViewerFind, type FindStatus } from './viewer-find';
import type { Highlighted } from './highlight-config';
import { clearSyntax, paintSyntax, supportsHighlights, viewerText } from './syntax-highlights';
import { currentTheme } from './highlight-theme';
import { PrintListing, type PrintSource } from './print-listing';
import './solarized-dark-hljs.css';

export interface ViewCallbacks {
  onContentInput: (content: string) => void;
  onFileDrop: (content: string) => void;
}

export interface RenderOptions {
  appName: string;
  lineNumbers: boolean;
  highlightCurrentLine: boolean;
}

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || navigator.userAgent.includes('Mac');
}

export class ViewManager {
  private editor: HTMLTextAreaElement;
  private viewer: HTMLPreElement;
  private viewerCode: HTMLElement;
  private gutter: HTMLDivElement;
  private appName: string;
  private lineNumbers: boolean;
  private callbacks?: ViewCallbacks;
  private readonly isMac: boolean = isMacPlatform();
  private readonly ZOOM_KEY = 'editor-zoom';
  private readonly ZOOM_STEP = 0.1;
  private readonly ZOOM_MIN = 0.5;
  private readonly ZOOM_MAX = 3.0;
  private editorZoom: number = 1;
  private lineHighlight: HTMLDivElement | null = null;
  private highlightCurrentLine: boolean;
  private currentLine: number = 0;
  private dragCounter: number = 0;
  private finder: ViewerFind;

  constructor(options: RenderOptions) {
    this.appName = options.appName;
    this.editor = document.getElementById('editor') as HTMLTextAreaElement;
    this.viewer = document.getElementById('viewer') as HTMLPreElement;
    this.viewerCode = this.viewer.querySelector('code') as HTMLElement;
    this.gutter = document.getElementById('gutter') as HTMLDivElement;
    this.finder = new ViewerFind(this.viewerCode, this.viewer);

    this.lineNumbers = options.lineNumbers;
    if (!this.lineNumbers) {
      this.gutter.style.display = 'none';
    }

    this.highlightCurrentLine = options.highlightCurrentLine;
    if (this.highlightCurrentLine) {
      this.lineHighlight = document.getElementById('line-highlight') as HTMLDivElement;
    }

    new PrintListing(() => this.printSource());
  }

  /** What to print: the viewer's or the editor's text; nothing behind a gate. */
  private printSource(): PrintSource | null {
    const numbers = this.lineNumbers;
    if (this.viewer.style.display !== 'none') {
      const text = this.viewerCode.textContent ?? '';
      if (text === '' || this.viewer.classList.contains('is-loading')) return null;
      return { text, numbers };
    }
    if (this.editor.style.display !== 'none') {
      if (this.editor.value === '') return null;
      return { text: viewerText(this.editor.value), numbers };
    }
    return null;
  }

  /**
   * Set event callbacks
   */
  setCallbacks(callbacks: ViewCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Initialize event listeners
   */
  init(): void {
    this.setupEditorHandlers();
    this.setupLineHighlightListeners();
    this.initZoom();
    this.setupDragDropHandlers();
  }

  /**
   * Setup textarea event handlers (Tab key and input notifications)
   */
  private setupEditorHandlers(): void {
    // Tab indents. Escape, then Tab, lets focus leave instead (no keyboard trap).
    let tabReleased = false;
    this.editor.addEventListener('blur', () => {
      tabReleased = false;
    });
    this.editor.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        tabReleased = true;
        return;
      }
      if (tabReleased && ['Shift', 'Control', 'Alt', 'Meta'].includes(evt.key)) return;
      const release = tabReleased;
      tabReleased = false;
      if (evt.key === 'Tab' && release) return; // default action moves focus
      if (evt.key === 'Tab') {
        evt.preventDefault();
        const start = this.editor.selectionStart;
        const end = this.editor.selectionEnd;
        const value = this.editor.value;

        if (start === end) {
          // No selection: insert 2 spaces
          const scrollTop = this.editor.scrollTop;
          this.editor.value = value.substring(0, start) + '  ' + value.substring(end);
          this.editor.selectionStart = this.editor.selectionEnd = start + 2;
          this.editor.scrollTop = scrollTop;
        } else {
          // Selection: indent all selected lines
          const selected = value.substring(start, end);
          const indented = selected
            .split('\n')
            .map((l) => '  ' + l)
            .join('\n');
          this.editor.value = value.substring(0, start) + indented + value.substring(end);
          this.editor.selectionStart = start;
          this.editor.selectionEnd = start + indented.length;
        }
        this.notifyContentChange();
      }
    });

    // Notify on any input
    this.editor.addEventListener('input', () => {
      this.notifyContentChange();
    });
  }

  private notifyContentChange(): void {
    const content = this.editor.value;
    const lineCount = content === '' ? 1 : (content.match(/\n/g) ?? []).length + 1;
    this.callbacks?.onContentInput?.(content);
    this.updateGutter(lineCount, false);
    this.updateLineHighlight();
  }

  /**
   * Get current content from editor
   */
  getContentFromDOM(): string {
    return this.editor.value;
  }

  /**
   * Render full state including editor (for loading/reset)
   */
  renderFullState(state: Paste, mode: 'editing' | 'presenting', highlighted?: Highlighted): void {
    this.finder.clear();
    clearSyntax();
    this.editor.classList.remove('is-loading');
    this.viewer.classList.remove('is-loading');

    if (mode === 'presenting' && highlighted) {
      // Present mode: show viewer, hide editor
      this.editor.value = '';
      this.editor.style.display = 'none';
      this.viewer.style.display = 'block';
      this.renderViewerContent(state.content, highlighted);
      const lineCount = (viewerText(state.content).match(/\n/g) ?? []).length + 1;
      this.updateGutter(lineCount, true);
      // this.resetLineHighlight();
      this.highlightAnchorLine();
    } else {
      // Edit mode: show editor, hide viewer
      this.editor.style.display = 'block';
      this.viewer.style.display = 'none';
      this.editor.value = state.content;
      this.editor.focus();
      this.editor.scrollTop = 0; // force reflow so field-sizing:content takes effect immediately
      const lineCount =
        state.content === '' ? 1 : (viewerText(state.content).match(/\n/g) ?? []).length + 1;
      this.updateGutter(lineCount, false);
      this.updateLineHighlight();
    }
    this.renderUIState(state);
  }

  /**
   * Fill the viewer: one plain text node with LF line endings (the
   * server-rendered one is kept when it matches), with the tokens painted over
   * it as highlight ranges. Without the Custom Highlight API the paste stays
   * plain text.
   */
  private renderViewerContent(content: string, highlighted: Highlighted): void {
    const shown = viewerText(content);
    const first = this.viewerCode.firstChild;
    const reuse =
      first instanceof Text && first === this.viewerCode.lastChild && first.data === shown;
    if (!reuse) this.viewerCode.textContent = shown;
    const text = this.viewerCode.firstChild;
    if (!(text instanceof Text) || !highlighted.runs || !supportsHighlights()) return;
    paintSyntax(text, currentTheme().spans(highlighted.runs));
  }

  renderLoadingState(): void {
    clearSyntax();
    this.editor.style.display = 'none';
    this.viewer.style.display = 'block';
    this.viewer.classList.add('is-loading');
    this.viewerCode.textContent = '';
    this.gutter.textContent = '';
    this.resetLineHighlight();
  }

  /** Give focus back to the editor (after a question in the island), if it is showing. */
  focusEditor(): void {
    if (this.editor.style.display !== 'none') this.editor.focus({ preventScroll: true });
  }

  /**
   * Behind the burn or passphrase prompt (the island asks): a blank page,
   * since nothing of the paste has been fetched.
   */
  renderBurnGate(): void {
    this.finder.clear();
    this.editor.value = '';
    this.editor.style.display = 'none';
    this.viewer.style.display = 'none';
    this.viewer.classList.remove('is-loading');
    this.viewerCode.textContent = '';
    this.gutter.textContent = '';
    this.resetLineHighlight();
    document.title = this.appName;
  }

  /**
   * Render metadata only (during editing - don't touch textarea)
   */
  renderUIState(state: Paste): void {
    this.updateTitle(state);
  }

  /**
   * Update document title
   */
  private updateTitle(state: Paste): void {
    if (state.isLoaded) {
      document.title = `${this.appName} - ${state.key}`;
    } else {
      document.title = this.appName;
    }
  }

  private initZoom(): void {
    const stored = sessionStorage.getItem(this.ZOOM_KEY);
    if (stored !== null) {
      this.editorZoom = parseFloat(stored);
    }
    this.applyZoom();
  }

  private applyZoom(): void {
    const container = document.getElementById('editor-container')!;
    container.style.setProperty('--editor-zoom', String(this.editorZoom));
    sessionStorage.setItem(this.ZOOM_KEY, String(this.editorZoom));
    this.updateLineHighlight();
  }

  /** Find in the viewer: step 0 starts a new search, 1/-1 move between matches. */
  find(text: string, step: 0 | 1 | -1): FindStatus {
    return step === 0 ? this.finder.search(text) : this.finder.step(step);
  }

  clearFind(): void {
    this.finder.clear();
  }

  /**
   * Zoom the editor by one step in either direction, or reset it.
   * Returns the new level and whether it is pinned at a limit.
   */
  zoom(direction: 1 | -1 | 'reset'): { level: number; atLimit: boolean } {
    if (direction === 'reset') {
      this.editorZoom = 1;
      this.applyZoom();
    } else {
      this.adjustZoom(direction * this.ZOOM_STEP);
    }
    const atLimit = this.editorZoom <= this.ZOOM_MIN || this.editorZoom >= this.ZOOM_MAX;
    return { level: this.editorZoom, atLimit };
  }

  /**
   * Move to a 1-based line (clamped). Presenting: set the #L anchor and
   * highlight it. Editing: place the caret at the start of the line.
   */
  goToLine(line: number): void {
    const presenting = this.viewer.style.display !== 'none';
    const content = presenting ? (this.viewerCode.textContent ?? '') : this.editor.value;
    const lineCount = (content.match(/\n/g) ?? []).length + 1;
    const target = Math.min(Math.max(1, line), lineCount);

    if (presenting) {
      history.replaceState(history.state, '', `#L${target}`);
      this.highlightAnchorLine();
    } else {
      let pos = 0;
      for (let i = 1; i < target; i++) pos = content.indexOf('\n', pos) + 1;
      this.editor.focus({ preventScroll: true });
      this.editor.setSelectionRange(pos, pos);
      this.updateLineHighlight();
    }
    this.scrollToLine(target);
  }

  /** Scroll the page so the given 1-based line sits mid-viewport. */
  private scrollToLine(line: number): void {
    const container = document.getElementById('editor-container')!;
    const lineHeight = parseFloat(getComputedStyle(container).lineHeight) || 20;
    const lineTop =
      container.getBoundingClientRect().top + window.scrollY + (line - 1) * lineHeight;
    const top = lineTop - window.innerHeight / 2 + lineHeight / 2;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }

  private adjustZoom(delta: number): void {
    this.editorZoom = parseFloat(
      Math.min(this.ZOOM_MAX, Math.max(this.ZOOM_MIN, this.editorZoom + delta)).toFixed(2)
    );
    this.applyZoom();
  }

  private updateGutter(lineCount: number, presenting: boolean): void {
    if (!this.lineNumbers) return;

    if (!presenting) {
      // Edit mode: clear gutter content but keep element visible for layout
      this.gutter.textContent = '';
      return;
    }

    // Present mode: populate with clickable line numbers
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lineCount; i++) {
      const el = document.createElement('a');
      el.href = `#L${i}`;
      el.id = `L${i}`;
      // The gutter is aria-hidden; keep its links out of the Tab order too.
      el.tabIndex = -1;
      el.textContent = String(i);
      frag.appendChild(el);
    }
    this.gutter.textContent = '';
    this.gutter.appendChild(frag);
  }

  private getCurrentLineNumber(): number {
    const pos = this.editor.selectionStart;
    const textBefore = this.editor.value.substring(0, pos);
    return (textBefore.match(/\n/g) ?? []).length + 1;
  }

  private updateLineHighlight(): void {
    if (!this.highlightCurrentLine || !this.lineHighlight) return;

    // Presenting mode: the #L anchor owns the highlight (highlightAnchorLine).
    if (this.editor.style.display === 'none') return;

    const hasFocus = document.activeElement === this.editor;
    const hasSelection = this.editor.selectionStart !== this.editor.selectionEnd;

    if (!hasFocus || hasSelection) {
      this.lineHighlight.classList.remove('visible');
      this.currentLine = 0;
      return;
    }

    const lineNumber = this.getCurrentLineNumber();
    if (lineNumber === this.currentLine) return;

    this.currentLine = lineNumber;

    // Use CSS custom property for line position (CSS calculates: --line-index * 1lh)
    this.lineHighlight.style.setProperty('--line-index', String(lineNumber - 1));
    this.lineHighlight.classList.add('visible');
  }

  private resetLineHighlight(): void {
    if (!this.highlightCurrentLine || !this.lineHighlight) return;
    this.lineHighlight.classList.remove('visible');
    this.currentLine = 0;
  }

  private highlightAnchorLine(): void {
    if (!this.highlightCurrentLine || !this.lineHighlight) return;
    const match = window.location.hash.match(/^#L(\d+)$/);
    if (!match) {
      this.resetLineHighlight();
      return;
    }
    const lineNumber = parseInt(match[1], 10);
    this.lineHighlight.style.setProperty('--line-index', String(lineNumber - 1));
    this.lineHighlight.classList.add('visible');
    this.currentLine = lineNumber;
  }

  private setupDragDropHandlers(): void {
    const overlay = document.getElementById('drop-overlay')!;

    document.addEventListener('dragenter', (evt) => {
      evt.preventDefault();
      this.dragCounter++;
      if (this.dragCounter === 1) {
        overlay.classList.add('visible');
      }
    });

    document.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      evt.dataTransfer!.dropEffect = 'copy';
    });

    document.addEventListener('dragleave', () => {
      this.dragCounter--;
      if (this.dragCounter === 0) overlay.classList.remove('visible');
    });

    document.addEventListener('drop', (evt) => {
      evt.preventDefault();
      this.dragCounter = 0;
      overlay.classList.remove('visible');

      const file = evt.dataTransfer?.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        if (content !== '') this.callbacks?.onFileDrop(content);
      };
      reader.readAsText(file);
    });
  }

  /**
   * Setup line highlight event listeners
   */
  private setupLineHighlightListeners(): void {
    if (!this.highlightCurrentLine) return;

    document.addEventListener('selectionchange', () => {
      this.updateLineHighlight();
    });

    this.editor.addEventListener('focus', () => {
      this.updateLineHighlight();
    });

    this.editor.addEventListener('blur', () => {
      if (this.editor.style.display !== 'none') this.resetLineHighlight();
    });

    window.addEventListener('hashchange', () => {
      const isPresenting = this.viewer.style.display !== 'none';
      if (isPresenting) {
        this.highlightAnchorLine();
      }
    });
  }
}
