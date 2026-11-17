/**
 * AppController - Orchestrator
 *
 * Responsibilities:
 * - Owns document lifecycle state machine: loading | editing | presenting | saving
 * - Coordinates all modules
 * - Public API is synchronous
 * - Manages async operations internally with consistent error handling
 */

import { Paste } from './paste';
import { ViewManager, isMacPlatform } from './view-manager';
import { CommandPalette } from './command-palette';
import { TransitionManager } from './transition-manager';
import appConfig from './config';
import { buildPath, parsePath, type ParsedPath } from './path-utils';
import { getExtensionForLanguage, highlightContent, listLanguages } from './highlight-config';
import type { PaletteItem } from './commands';
import { DocumentSession } from './document-session';
import { NavigationState, type HistoryState } from './navigation-state';
import { Notifications } from './notifications';
import { DraftStore } from './draft-store';
import { RecentStore } from './recent-store';
import { advanceStage, HintStageStore, type HintEvent, type HintStage } from './hint-stage';

type ViewMode = 'editing' | 'presenting';

/** How long the first-visit "commands Ctrl /" hint stays expanded. */
const FIRST_HINT_MS = 8000;

/** Palette item id for the "Clear recent pastes" row (never a paste key). */
const CLEAR_RECENT_ID = '/clear';
type ActivityState = 'idle' | 'loading' | 'saving';

export interface AppConfig {
  appName: string;
  enableTwitter: boolean;
  scrollToTopOnSave?: boolean; // default true
  lineNumbers?: boolean; // default true
  highlightCurrentLine?: boolean; // default true
}

export class AppController {
  // Module dependencies
  private document: Paste;
  private session: DocumentSession;
  private view: ViewManager;
  private transitions: TransitionManager;
  private navigation: NavigationState;
  private notify: Notifications;
  private draft: DraftStore;
  private palette: CommandPalette;
  private recent = new RecentStore();
  private hints = new HintStageStore();
  private hintStage: HintStage = 'learn';
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly enableTwitter: boolean;

  // State machine
  private viewMode: ViewMode = 'editing';
  private activity: ActivityState = 'idle';
  private scrollToTopOnSave: boolean;
  private isFirstLoad = true;
  /** False until the first full render; that one skips the page wipe. */
  private hasRendered = false;

  private get isBusy(): boolean {
    return this.activity !== 'idle';
  }

  constructor(options: AppConfig) {
    this.scrollToTopOnSave = options.scrollToTopOnSave !== false;

    // Initialize modules
    this.document = new Paste();
    this.session = new DocumentSession();
    this.notify = new Notifications();
    this.draft = new DraftStore();
    this.enableTwitter = options.enableTwitter;
    this.view = new ViewManager({
      appName: options.appName,
      lineNumbers: options.lineNumbers ?? true,
      highlightCurrentLine: options.highlightCurrentLine ?? true,
    });
    this.transitions = new TransitionManager();

    const isMac = isMacPlatform();
    this.palette = new CommandPalette(document.getElementById('island')!, {
      context: () => ({
        mode: this.viewMode,
        canSave: this.canSave(),
        frozen: this.document.frozen,
        hasKey: this.document.key !== undefined,
        enableTwitter: this.enableTwitter,
        isMac,
      }),
      run: (id) => this.runCommand(id),
      submenu: (id) => this.submenuItems(id),
      runSubmenu: (menuId, itemId) => this.runSubmenuItem(menuId, itemId),
      goToLine: (line) => this.view.goToLine(line),
      find: (text, step) => this.view.find(text, step),
      clearFind: () => this.view.clearFind(),
    });

    // Wire up view callbacks
    this.view.setCallbacks({
      onContentInput: (content) => this.handleContentInput(content),
      onFileDrop: (content) => this.handleFileDrop(content),
    });

    // Initialize history manager
    this.navigation = new NavigationState();
    this.navigation.onNavigate((path, state) => {
      const route = parsePath(path);
      if (!route.key) {
        this.handleRoot(state);
      } else {
        this.loadDocumentByPath(route, 'presenting', state as HistoryState);
      }
    });
  }

  /**
   * Initialize the application
   */
  init(): void {
    history.scrollRestoration = 'manual';
    this.view.init();
    this.palette.init();
    this.initHints();
    window.addEventListener('beforeunload', (e) => {
      if (this.viewMode === 'editing' && this.document.content.trim()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.navigation.resolve();
  }

  /**
   * Handle root route (/)
   */
  private handleRoot(state?: unknown): void {
    if (this.isBusy) return;

    const isFirstLoad = this.isFirstLoad;
    this.isFirstLoad = false;
    const historyState = state as HistoryState | undefined;
    const targetScrollY = historyState?.scrollY ?? 0;

    this.document.reset();
    if (historyState?.content) {
      this.document.content = historyState.content;
    } else if (isFirstLoad) {
      // Fresh visit: restore an unsaved draft from a previous session
      const draft = this.draft.load();
      if (draft) {
        this.document.content = draft;
        this.notify.toast('Restored unsaved draft');
      }
    }
    this.transitionToView('editing', { scrollY: targetScrollY });
  }

  /**
   * Command: Create new document
   */
  private newDocument(pushState: boolean): void {
    if (this.isBusy) return;

    if (pushState) {
      this.openDraftEntry();
    }

    this.document.reset();
    this.transitionToView('editing');
  }

  /**
   * Command: Save current document
   */
  private async saveDocument(): Promise<void> {
    if (this.viewMode !== 'editing' || this.activity !== 'idle') {
      return;
    }

    const content = this.view.getContentFromDOM();
    if (!content.trim()) {
      return;
    }

    this.document.content = content;

    try {
      this.activity = 'saving';
      this.notify.progressStart();

      const result = await this.session.save(this.document.content);
      this.document.apply(result.paste);
      this.draft.clear();
      this.recent.record(result.paste.key, result.canonicalPath, content);

      this.activity = 'idle';
      setTimeout(() => {
        this.notify.progressDone();
      }, 500);

      this.navigation.replaceDraft(window.location.pathname, content, window.scrollY);
      this.navigation.pushPath(result.canonicalPath);
      this.transitionToView('presenting', {
        highlighted: result.highlighted,
        scrollY: this.scrollToTopOnSave ? 0 : null,
      });
    } catch (err) {
      console.error('Save failed:', err);

      // Fallback: stay in editing mode
      this.notify.progressDone();
      this.activity = 'idle';
      this.viewMode = 'editing';
      this.view.renderUIState(this.document);
      this.syncChrome();

      this.notify.toast('Failed to save. Please try again.', 'error');
    }
  }

  /**
   * Load document by path (key with optional extension)
   */
  private async loadDocumentByPath(
    path: ParsedPath,
    defaultMode: 'editing' | 'presenting',
    historyState?: HistoryState
  ): Promise<void> {
    // Guard: can't load while loading/saving
    if (this.isBusy) return;

    const hideWhileLoading = this.isFirstLoad;
    this.isFirstLoad = false;
    this.activity = 'loading';
    if (hideWhileLoading) {
      this.view.renderLoadingState();
      // Show the island in its target mode while the paste loads.
      this.palette.setMode(defaultMode);
      this.palette.settle();
    }
    try {
      const result = await this.session.load(path);
      this.document.apply(result.paste);
      if (!result.paste.frozen) {
        this.recent.record(result.paste.key, result.canonicalPath, result.paste.content);
      }

      this.activity = 'idle';

      // For view mode without extension, ensure URL has extension (use replace to avoid duplicate entries)
      if (
        defaultMode === 'presenting' &&
        !path.ext &&
        result.canonicalPath !== window.location.pathname
      ) {
        this.navigation.replacePath(result.canonicalPath);
      }

      const targetScrollY = historyState?.scrollY ?? 0;

      // Render with transition
      this.transitionToView(defaultMode, {
        highlighted: defaultMode === 'presenting' ? result.highlighted : undefined,
        scrollY: targetScrollY,
      });
    } catch (err) {
      console.error('Load failed:', err);
      if (err instanceof Error && err.message === 'Document not found') {
        this.recent.remove(path.key);
      }

      // Fallback: show new document
      this.activity = 'idle';
      this.document.reset();
      this.navigation.replacePath('/');
      this.notify.toast('Document not found.', 'error');
      this.transitionToView('editing');
    }
  }

  private transitionToView(
    mode: ViewMode,
    options: { highlighted?: string; scrollY?: number | null } = {}
  ): void {
    this.viewMode = mode;
    // Close first: renderFullState may move focus into the editor.
    this.palette.close(false);
    const render = () => {
      this.view.renderFullState(this.document, mode, options.highlighted);
      this.syncChrome();
      this.palette.settle();
      if (options.scrollY !== null && options.scrollY !== undefined) {
        window.scrollTo({ top: options.scrollY, behavior: 'instant' });
      }
    };
    // The page wipe is for in-app navigation; the first render appears as-is.
    if (this.hasRendered) {
      this.transitions.run(render);
    } else {
      this.hasRendered = true;
      render();
    }
  }

  private initHints(): void {
    this.hintStage = this.hints.load();
    this.palette.setStage(this.hintStage);
    this.palette.onOpened(() => this.advanceHint('open'));
    if (this.hintStage === 'first') {
      this.hintTimer = setTimeout(() => this.advanceHint('timeout'), FIRST_HINT_MS);
    }
  }

  private advanceHint(event: HintEvent): void {
    const next = advanceStage(this.hintStage, event);
    if (next === this.hintStage) return;
    this.hintStage = next;
    this.hints.save(next);
    this.palette.setStage(next);
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  private canSave(): boolean {
    return this.viewMode === 'editing' && this.document.content.trim() !== '';
  }

  /** Reflect mode and save availability in the island. */
  private syncChrome(): void {
    this.palette.setMode(this.viewMode);
    this.palette.setSaveEnabled(this.canSave());
  }

  /** Dispatch a command palette command id. */
  /** Zoom the editor and flash the new font size. */
  private zoom(direction: 1 | -1 | 'reset'): void {
    const { level, atLimit } = this.view.zoom(direction);
    const percent = `${Math.round(level * 100)}%`;
    this.notify.toast(`Font size ${percent}${atLimit ? ' (limit)' : ''}`, 'info', { brief: true });
  }

  private runCommand(id: string): void {
    switch (id) {
      case 'save':
        return this.handleSave();
      case 'new':
        return this.handleNew();
      case 'duplicate':
        return this.handleDuplicate();
      case 'copy-link':
        return this.handleCopyLink();
      case 'raw':
        return this.handleRaw();
      case 'twitter':
        return this.handleTwitter();
      case 'zoom-in':
        return this.zoom(1);
      case 'zoom-out':
        return this.zoom(-1);
      case 'zoom-reset':
        return this.zoom('reset');
      case 'about':
        return this.openPath('/about.md');
    }
  }

  private submenuItems(menuId: string): PaletteItem[] {
    if (menuId === 'language') {
      const current = this.document.language ?? '';
      return listLanguages().map((lang) => ({
        id: lang.id,
        label: lang.name,
        hint: lang.id === current ? 'current' : `.${lang.ext}`,
        keywords: [lang.ext, lang.id],
      }));
    }
    if (menuId === 'recent') {
      const entries = this.recent.list();
      const items: PaletteItem[] = entries.map((entry) => ({
        id: entry.key,
        label: entry.preview,
        hint: entry.key,
        keywords: [entry.key],
      }));
      if (entries.length > 0) {
        items.push({ id: CLEAR_RECENT_ID, label: 'Clear recent pastes', keywords: ['forget'] });
      }
      return items;
    }
    return [];
  }

  private runSubmenuItem(menuId: string, itemId: string): void {
    if (menuId === 'language') {
      this.setLanguage(itemId);
    } else if (menuId === 'recent') {
      if (itemId === CLEAR_RECENT_ID) {
        this.recent.clear();
        this.notify.toast('Recent pastes cleared');
        return;
      }
      const entry = this.recent.list().find((e) => e.key === itemId);
      // Re-picking the paste already on screen is a no-op (no duplicate history entry).
      if (entry && !(this.viewMode === 'presenting' && entry.key === this.document.key)) {
        this.openPath(entry.path);
      }
    }
  }

  /** Re-highlight the presented paste with another language ('' = plain). */
  private setLanguage(id: string): void {
    if (this.viewMode !== 'presenting' || this.isBusy || !this.document.key) return;

    const result = highlightContent(this.document.content, id === '' ? 'txt' : id);
    this.document.language = id === '' ? undefined : id;
    const ext = id === '' ? 'txt' : getExtensionForLanguage(id);
    const path = buildPath(this.document.key, ext);
    this.navigation.replacePath(path + window.location.hash, this.navigation.currentState());
    if (!this.document.frozen) this.recent.record(this.document.key, path, this.document.content);
    this.view.renderFullState(this.document, 'presenting', result.highlighted);
    this.syncChrome();
  }

  /** Navigate to a paste path, keeping the current entry restorable. */
  private openPath(path: string): void {
    if (this.isBusy) return;
    if (this.viewMode === 'editing' && this.document.content) {
      this.navigation.replaceDraft(window.location.pathname, this.document.content, window.scrollY);
    } else {
      this.captureScrollInHistory();
    }
    this.navigation.pushPath(path);
    void this.loadDocumentByPath(parsePath(path), 'presenting');
  }

  private captureScrollInHistory(): void {
    this.navigation.captureScroll(window.location.pathname);
  }

  /**
   * Handle save button/shortcut
   */
  private handleSave(): void {
    void this.saveDocument();
  }

  /**
   * Handle new button/shortcut
   */
  private handleNew(): void {
    if (this.viewMode === 'editing' || this.viewMode === 'presenting') {
      if (
        this.viewMode === 'editing' &&
        this.document.content.trim() &&
        !window.confirm('Discard unsaved changes?')
      ) {
        return;
      }
      if (this.viewMode === 'editing') this.draft.clear();
      this.newDocument(true);
    }
  }

  /**
   * Handle duplicate button/shortcut
   */
  private handleDuplicate(): void {
    if (this.viewMode === 'presenting' && this.activity === 'idle' && !this.document.frozen) {
      const content = this.document.content;
      this.document.reset();
      this.document.content = content;
      this.transitionToView('editing');
    }
  }

  /**
   * Handle copy link button/shortcut
   */
  private handleCopyLink(): void {
    if (this.viewMode !== 'presenting' || this.activity !== 'idle') return;

    navigator.clipboard.writeText(window.location.href).then(
      () => this.notify.toast('Link copied to clipboard'),
      () => this.notify.toast('Could not copy link.', 'error')
    );
  }

  /**
   * Handle raw view button/shortcut
   */
  private handleRaw(): void {
    if (
      this.viewMode === 'presenting' &&
      this.activity === 'idle' &&
      !this.document.frozen &&
      this.document.key
    ) {
      window.open(`/raw/${this.document.key}`, '_blank', 'noopener');
    }
  }

  /**
   * Handle twitter button/shortcut
   */
  private handleTwitter(): void {
    if (this.viewMode === 'presenting' && this.activity === 'idle') {
      window.open('https://twitter.com/share?url=' + encodeURI(window.location.href));
    }
  }

  private handleFileDrop(content: string): void {
    if (this.isBusy) return;

    this.openDraftEntry();

    this.document.reset();
    this.document.content = content;
    this.transitionToView('editing');
  }

  /**
   * Handle content input from textarea
   */
  private handleContentInput(content: string): void {
    // During editing phase, textarea owns content
    if (this.viewMode === 'editing') {
      this.document.content = content;
      this.draft.schedule(content);
      this.advanceHint('input');
      this.view.renderUIState(this.document);
      this.syncChrome();
    }
  }

  private openDraftEntry(): void {
    if (this.viewMode === 'editing' && this.document.content) {
      this.navigation.replaceDraft(window.location.pathname, this.document.content, window.scrollY);
    } else {
      this.captureScrollInHistory();
    }
    this.navigation.pushPath('/');
  }
}
