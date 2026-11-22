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
import {
  getExtensionForLanguage,
  highlightContent,
  listLanguages,
  type Highlighted,
} from './highlight-config';
import { hasEmbeddedDocument } from './embedded-document';
import { BurnPendingError, LockedError, UnlockRejectedError } from './storage';
import {
  MIN_PASSPHRASE_LENGTH,
  generatePassphrase,
  loadWordlist,
  normalizePassphrase,
} from './lock-crypto';
import { LifetimeStore } from './lifetime-store';
import { LIFETIMES, LIFETIME_LABELS, isLifetimeId, type LifetimeId } from '../shared/types';
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
/** Expires submenu item for the server default lifetime (never a preset id). */
const DEFAULT_LIFETIME_ID = 'default';
/** Recent-list preview of a protected paste: its text never goes to localStorage. */
const LOCKED_PREVIEW = 'Protected paste';

/** The next save's protection: a generated passphrase, or the user's own. */
type LockChoice = { kind: 'generated' } | { kind: 'own'; passphrase: string };

/** A protected paste behind the passphrase gate. */
interface PendingLock {
  path: ParsedPath;
  salt: string;
  burn: boolean;
}
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
  private lifetimes = new LifetimeStore();
  /** Lifetime for new pastes; null = server default. Remembered per browser. */
  private lifetime: LifetimeId | null = this.lifetimes.load();
  /** The next save is burn-after-reading; resets after each save. */
  private burnNext = false;
  /** The unread burn paste behind the reveal gate. */
  private pendingBurn: ParsedPath | null = null;
  /** The next save is protected; resets after each save. */
  private lockNext: LockChoice | null = null;
  /** The protected paste behind the passphrase gate. */
  private pendingLock: PendingLock | null = null;
  /** Passphrases of protected pastes saved in this tab, for "Copy passphrase". Memory only. */
  private passphrases = new Map<string, string>();

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
        burn: this.document.burn,
        burnNext: this.burnNext,
        lifetimeLabel: this.lifetime ? LIFETIME_LABELS[this.lifetime] : 'default',
        lock: this.document.locked ? (this.pendingLock ? 'pending' : 'open') : undefined,
        lockNext: this.lockNext?.kind,
        hasPassphrase: this.document.key !== undefined && this.passphrases.has(this.document.key),
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
    this.navigation.onNavigate((path, state, info) => {
      const route = parsePath(path);
      // After a browser-animated step (swipe back/forward) render in place:
      // a page wipe on top of the browser's own animation reads as a blink.
      const animate = !info.browserAnimated;
      if (!route.key) {
        this.handleRoot(state, animate);
      } else {
        this.loadDocumentByPath(route, 'presenting', state as HistoryState, animate);
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
      // Unsaved text, or a revealed burn paste (no copy is left anywhere else).
      const unsaved = this.viewMode === 'editing' && this.document.content.trim() !== '';
      if (unsaved || this.document.burn === 'burned') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.navigation.resolve();
  }

  /**
   * Handle root route (/)
   */
  private handleRoot(state?: unknown, animate = true): void {
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
    this.transitionToView('editing', { scrollY: targetScrollY, animate });
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

      const lock = this.lockNext;
      const passphrase = !lock
        ? undefined
        : lock.kind === 'own'
          ? lock.passphrase
          : generatePassphrase(await loadWordlist());
      const result = await this.session.save(this.document.content, {
        expires: this.lifetime ?? undefined,
        burn: this.burnNext,
        passphrase,
      });
      this.document.apply(result.paste);
      this.draft.clear();
      const burn = result.paste.burn !== undefined;
      this.burnNext = false;
      this.lockNext = null;
      if (passphrase !== undefined) this.passphrases.set(result.paste.key, passphrase);
      // A burn paste is one-shot: no preview of it is kept in localStorage.
      if (!burn) this.recordRecent(result.paste.key, result.canonicalPath);
      if (burn && !lock) this.notify.toast('Burn link ready: it can be opened once');
      if (lock?.kind === 'own') {
        this.notify.toast(
          burn ? 'Protected burn link ready: it can be opened once' : 'Protected link ready'
        );
      }

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
      if (lock?.kind === 'generated') this.showPassphrase(passphrase!, burn);
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
    historyState?: HistoryState,
    animate = true
  ): Promise<void> {
    // Guard: can't load while loading/saving
    if (this.isBusy) return;

    this.pendingBurn = null;
    this.pendingLock = null;
    // A server-rendered page already shows the text: don't blank it while "loading".
    const hideWhileLoading = this.isFirstLoad && !hasEmbeddedDocument(path.key);
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
      if (!result.paste.frozen && !result.paste.burn) {
        this.recordRecent(result.paste.key, result.canonicalPath);
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
        animate,
      });
    } catch (err) {
      this.activity = 'idle';
      if (err instanceof BurnPendingError) {
        this.showBurnGate(path);
        return;
      }
      if (err instanceof LockedError) {
        this.showLockGate({ path, salt: err.salt, burn: err.burn });
        return;
      }
      this.showLoadFailure(path, err);
    }
  }

  /** Fallback after a failed load: a new document, and the paste is forgotten. */
  private showLoadFailure(path: ParsedPath, err: unknown): void {
    console.error('Load failed:', err);
    if (err instanceof Error && err.message === 'Document not found') {
      this.recent.remove(path.key);
    }

    this.document.reset();
    this.navigation.replacePath('/');
    this.notify.toast('Document not found.', 'error');
    this.transitionToView('editing');
  }

  /** An unread burn paste: ask before reading it, since reading destroys it. */
  private showBurnGate(path: ParsedPath): void {
    this.pendingBurn = path;
    this.document.reset();
    this.document.key = path.key;
    this.document.burn = 'pending';
    this.viewMode = 'presenting';
    this.palette.close(false);
    this.hasRendered = true;
    this.view.renderBurnGate();
    this.syncChrome();
    this.palette.showPrompt({
      title: 'Burn after reading',
      text: 'This paste can be read once. Opening it deletes it from the server for good.',
      confirmLabel: 'Open and burn',
      busyLabel: 'Opening...',
      cancelLabel: 'New paste',
      confirm: () => void this.revealBurn(),
      cancel: () => this.newDocument(true),
    });
  }

  /** A protected paste: ask for the passphrase; nothing of it is fetched until then. */
  private showLockGate(pending: PendingLock): void {
    this.pendingLock = pending;
    this.document.reset();
    this.document.key = pending.path.key;
    this.document.locked = true;
    this.viewMode = 'presenting';
    this.palette.close(false);
    this.hasRendered = true;
    this.view.renderBurnGate();
    this.syncChrome();
    this.palette.showPrompt({
      title: 'Protected paste',
      text: pending.burn
        ? 'Enter the passphrase. Opening the paste also deletes it from the server.'
        : 'Enter the passphrase to open it.',
      input: { label: 'Passphrase', placeholder: 'passphrase' },
      confirmLabel: pending.burn ? 'Unlock and burn' : 'Unlock',
      busyLabel: 'Unlocking...',
      cancelLabel: 'New paste',
      confirm: (value) => void this.unlockPaste(value),
      cancel: () => {
        // Leaving the gate: a "Wrong passphrase" toast no longer applies.
        this.notify.dismiss();
        this.newDocument(true);
      },
    });
  }

  /** Try the passphrase on the paste behind the gate. */
  private async unlockPaste(passphrase: string): Promise<void> {
    const pending = this.pendingLock;
    if (this.isBusy || !pending) return;
    if (normalizePassphrase(passphrase) === '') {
      this.palette.rejectPrompt();
      return;
    }

    const { path } = pending;
    this.activity = 'loading';
    this.palette.setPromptBusy(true);
    this.notify.progressStart();
    try {
      const result = await this.session.unlock(path, pending.salt, passphrase);
      this.pendingLock = null;
      this.document.apply(result.paste);
      this.activity = 'idle';
      this.notify.progressDone();
      // A "Wrong passphrase" toast from an earlier try is answered now.
      this.notify.dismiss();
      this.palette.hidePrompt();
      if (result.paste.burn) this.recent.remove(path.key);
      else this.recordRecent(result.paste.key, result.canonicalPath);
      if (!path.ext && result.canonicalPath !== window.location.pathname) {
        this.navigation.replacePath(result.canonicalPath);
      }
      this.transitionToView('presenting', { highlighted: result.highlighted, scrollY: 0 });
      if (result.paste.burn) {
        this.notify.toast('Destroyed on the server: this tab holds the only copy');
      }
    } catch (err) {
      this.activity = 'idle';
      this.notify.progressDone();
      if (err instanceof UnlockRejectedError && err.attemptsLeft > 0) {
        this.palette.rejectPrompt();
        const left = err.attemptsLeft;
        this.notify.toast(
          `Wrong passphrase: ${left} ${left === 1 ? 'attempt' : 'attempts'} left`,
          'error'
        );
        return;
      }
      if (err instanceof UnlockRejectedError) {
        this.pendingLock = null;
        this.palette.hidePrompt();
        this.recent.remove(path.key);
        this.document.reset();
        this.navigation.replacePath('/');
        this.notify.toast('Too many wrong passphrases: the paste is deleted', 'error');
        this.transitionToView('editing');
        return;
      }
      if (err instanceof Error && err.message === 'Document not found') {
        this.pendingLock = null;
        this.palette.hidePrompt();
        this.showLoadFailure(path, err);
        return;
      }
      // The server took the passphrase, but the text does not decrypt with it.
      if (err instanceof DOMException && err.name === 'OperationError') {
        console.error('Decrypt failed:', err);
        this.palette.setPromptBusy(false);
        this.notify.toast('This paste is damaged and cannot be decrypted.', 'error');
        return;
      }
      console.error('Unlock failed:', err);
      this.palette.setPromptBusy(false);
      this.notify.toast('Could not reach the server. Try again.', 'error');
    }
  }

  /** Right after saving with a generated passphrase: show it once, offer to copy it. */
  private showPassphrase(passphrase: string, burn: boolean): void {
    this.palette.showPrompt({
      title: 'Passphrase',
      text: burn
        ? 'The link opens once, with this passphrase. Send them separately.'
        : 'The link opens with this passphrase. Send them separately.',
      secret: passphrase,
      confirmLabel: 'Copy passphrase',
      cancelLabel: 'Done',
      dismissible: true,
      confirm: () => {
        this.palette.hidePrompt();
        this.copyPassphrase();
      },
      cancel: () => this.palette.hidePrompt(),
    });
  }

  /** Ask for the user's own passphrase for the next save. */
  private askOwnPassphrase(): void {
    this.palette.showPrompt({
      title: 'Own passphrase',
      text:
        `At least ${MIN_PASSPHRASE_LENGTH} characters; longer is stronger. ` +
        'Case, spaces and dashes do not matter.',
      input: { label: 'Passphrase', placeholder: 'passphrase' },
      confirmLabel: 'Use',
      cancelLabel: 'Cancel',
      dismissible: true,
      confirm: (value) => {
        if (normalizePassphrase(value).length < MIN_PASSPHRASE_LENGTH) {
          this.palette.rejectPrompt();
          this.notify.toast(`Use at least ${MIN_PASSPHRASE_LENGTH} characters`, 'error');
          return;
        }
        this.lockNext = { kind: 'own', passphrase: value };
        this.closeQuestion();
        this.syncChrome();
        this.notify.toast('Next save is protected with your passphrase', 'info', { brief: true });
      },
      cancel: () => this.closeQuestion(),
    });
  }

  /** Fold a dismissible question and give the editor its focus back. */
  private closeQuestion(): void {
    this.palette.hidePrompt();
    this.view.focusEditor();
  }

  private copyPassphrase(): void {
    const key = this.document.key;
    const passphrase = key !== undefined ? this.passphrases.get(key) : undefined;
    if (passphrase === undefined) return;
    navigator.clipboard.writeText(passphrase).then(
      () => this.notify.toast('Passphrase copied to clipboard'),
      () => this.notify.toast('Could not copy the passphrase.', 'error')
    );
  }

  /** Remember a paste in the recent list; a protected one without its text. */
  private recordRecent(key: string, path: string): void {
    const content = this.document.locked ? LOCKED_PREVIEW : this.document.content;
    this.recent.record(key, path, content);
  }

  /** Read (and so destroy) the burn paste behind the gate. */
  private async revealBurn(): Promise<void> {
    const path = this.pendingBurn;
    if (this.isBusy || !path) return;

    this.activity = 'loading';
    this.palette.setPromptBusy(true);
    this.notify.progressStart();
    try {
      const result = await this.session.load(path, true);
      this.pendingBurn = null;
      this.document.apply(result.paste);
      this.recent.remove(path.key);
      this.activity = 'idle';
      this.notify.progressDone();
      this.palette.hidePrompt();
      if (!path.ext && result.canonicalPath !== window.location.pathname) {
        this.navigation.replacePath(result.canonicalPath);
      }
      this.transitionToView('presenting', { highlighted: result.highlighted, scrollY: 0 });
      this.notify.toast('Destroyed on the server: this tab holds the only copy');
    } catch (err) {
      this.activity = 'idle';
      this.notify.progressDone();
      // Only a 404 means it is gone. Anything else (offline, 5xx) never reached
      // the delete or lost its answer before we saw content: keep asking.
      if (err instanceof Error && err.message === 'Document not found') {
        this.pendingBurn = null;
        this.palette.hidePrompt();
        this.showLoadFailure(path, err);
        return;
      }
      console.error('Reveal failed:', err);
      this.palette.setPromptBusy(false);
      this.notify.toast('Could not reach the server. Try again.', 'error');
    }
  }

  private transitionToView(
    mode: ViewMode,
    options: { highlighted?: Highlighted; scrollY?: number | null; animate?: boolean } = {}
  ): void {
    this.viewMode = mode;
    this.pendingBurn = null;
    this.pendingLock = null;
    this.palette.hidePrompt();
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
    // The page wipe is for in-app navigation; the first render, and a step
    // the browser already animated, appear as-is.
    if (this.hasRendered && options.animate !== false) {
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

  /** Reflect mode, save availability and save options in the island. */
  private syncChrome(): void {
    this.palette.setMode(this.viewMode);
    this.palette.setSaveEnabled(this.canSave());
    // One icon on the chip: lock, then burn, then the lifetime clock; details are spoken.
    let spoken = 'Save';
    if (this.lifetime === 'never') spoken += ', permanent';
    else if (this.lifetime) spoken += `, expires in ${LIFETIME_LABELS[this.lifetime]}`;
    if (this.burnNext) spoken += ', burn after reading';
    if (this.lockNext) spoken += ', protected with a passphrase';
    const icon = this.lockNext ? 'lock' : this.burnNext ? 'burn' : this.lifetime ? 'clock' : null;
    this.palette.setSaveLabel(spoken, icon);
  }

  /** Zoom the editor and flash the new font size. */
  private zoom(direction: 1 | -1 | 'reset'): void {
    const { level, atLimit } = this.view.zoom(direction);
    const percent = `${Math.round(level * 100)}%`;
    this.notify.toast(`Font size ${percent}${atLimit ? ' (limit)' : ''}`, 'info', { brief: true });
  }

  /** Dispatch a command palette command id. */
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
      case 'lock':
        this.lockNext = this.lockNext ? null : { kind: 'generated' };
        this.syncChrome();
        this.notify.toast(
          this.lockNext ? 'Next save gets a passphrase' : 'Passphrase protection off',
          'info',
          { brief: true }
        );
        return;
      case 'lock-own':
        return this.askOwnPassphrase();
      case 'copy-passphrase':
        return this.copyPassphrase();
      case 'burn':
        this.burnNext = !this.burnNext;
        this.syncChrome();
        // The Save chip (and its flame) is hidden while the editor is empty.
        this.notify.toast(
          this.burnNext ? 'Next save burns after reading' : 'Burn after reading off',
          'info',
          { brief: true }
        );
        return;
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
    if (menuId === 'expiry') {
      const current = this.lifetime ?? DEFAULT_LIFETIME_ID;
      const ids = [DEFAULT_LIFETIME_ID, ...Object.keys(LIFETIMES)];
      return ids.map((id) => ({
        id,
        label: isLifetimeId(id) ? LIFETIME_LABELS[id] : 'Server default',
        hint: id === current ? 'current' : undefined,
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
    } else if (menuId === 'expiry') {
      this.lifetime = isLifetimeId(itemId) ? itemId : null;
      this.lifetimes.save(this.lifetime);
      const label = this.lifetime ? LIFETIME_LABELS[this.lifetime] : 'server default';
      this.notify.toast(`New pastes expire: ${label}`, 'info', { brief: true });
      this.syncChrome();
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
    if (this.document.burn === 'pending' || this.pendingLock) return;

    const result = highlightContent(this.document.content, id === '' ? 'txt' : id);
    this.document.language = id === '' ? undefined : id;
    const ext = id === '' ? 'txt' : getExtensionForLanguage(id);
    const path = buildPath(this.document.key, ext);
    this.navigation.replacePath(path + window.location.hash, this.navigation.currentState());
    if (!this.document.frozen && !this.document.burn) {
      this.recordRecent(this.document.key, path);
    }
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
    if (
      this.viewMode === 'presenting' &&
      this.activity === 'idle' &&
      !this.document.frozen &&
      this.document.burn !== 'pending' &&
      !this.pendingLock
    ) {
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
    if (this.document.burn === 'burned') return;

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
      !this.document.burn &&
      !this.document.locked &&
      this.document.key
    ) {
      window.open(`/raw/${this.document.key}`, '_blank', 'noopener');
    }
  }

  /**
   * Handle twitter button/shortcut
   */
  private handleTwitter(): void {
    if (this.viewMode === 'presenting' && this.activity === 'idle' && !this.document.burn) {
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
