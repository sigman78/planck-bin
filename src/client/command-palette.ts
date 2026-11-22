/**
 * CommandPalette - the "island" pill in the top-right corner.
 *
 * Folded, it shows the h-bar mark plus (depending on state) a Save chip,
 * a "commands" label and a "Ctrl /" keycap, growing to the left.
 * Opened (click, tap or Ctrl+/), it morphs into a searchable command list.
 *
 * The component owns its DOM, animation and keyboard handling only.
 * Behaviour lives in the PaletteHost (AppController).
 */

import {
  availableCommands,
  type CommandContext,
  type PaletteItem,
  type ViewMode,
  shortcutCommand,
} from './commands';
import { parseQuery, rankItems } from './palette-search';
import type { FindStatus } from './viewer-find';
import type { HintStage } from './hint-stage';

export interface PaletteHost {
  context(): CommandContext;
  run(id: string): void;
  submenu(id: string): PaletteItem[];
  runSubmenu(menuId: string, itemId: string): void;
  goToLine(line: number): void;
  find(text: string, step: 0 | 1 | -1): FindStatus;
  clearFind(): void;
}

interface Row {
  label: string;
  hint?: string;
  icon?: SaveIcon;
  disabled?: boolean;
  /** Runs on Enter/click. Return true to keep the palette open. */
  action?: (evt: { shiftKey: boolean }) => boolean | void;
}

/** The island's question mode (see showPrompt). */
export interface PromptOptions {
  title: string;
  text: string;
  /** Shown on its own line in a selectable monospace block (a generated passphrase). */
  secret?: string;
  /** A one-line text field; Enter confirms with its value. */
  input?: { label: string; placeholder?: string };
  confirmLabel: string;
  /** Confirm label while busy (setPromptBusy). */
  busyLabel?: string;
  cancelLabel: string;
  /** Escape cancels. Off for questions that must be answered. */
  dismissible?: boolean;
  /** Receives the field value ('' without an input). */
  confirm: (value: string) => void;
  cancel: () => void;
}

const MENU_TITLES: Record<string, string> = {
  language: 'Language',
  recent: 'Recent',
  expiry: 'Expires',
};

const COLLAPSE_FALLBACK_MS = 650;
const ROOT_PLACEHOLDER = 'Command, :line or ?find';

export class CommandPalette {
  private readonly hint: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly trigger: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly crumb: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptTitle: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly promptSecret: HTMLElement;
  private readonly promptInput: HTMLInputElement;
  private readonly promptConfirm: HTMLButtonElement;
  private readonly promptCancel: HTMLButtonElement;
  private promptOptions: PromptOptions | null = null;
  /** Bumped by every show/hide, so a stale deferred show does nothing. */
  private promptToken = 0;

  private menu: string | null = null;
  private menuItems: PaletteItem[] = [];
  private rows: Row[] = [];
  private selected = 0;
  private findStatus: FindStatus = { current: 0, total: 0 };
  private prevFocus: Element | null = null;
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private pointer: { x: number; y: number } | null = null;
  private openedCallbacks: Array<() => void> = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly host: PaletteHost
  ) {
    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    this.hint = q('.island-hint');
    this.saveBtn = q('.island-save');
    this.trigger = q('.island-trigger');
    this.panel = q('.island-panel');
    this.crumb = q('.island-crumb');
    this.input = q('.island-input');
    this.list = q('.island-list');
    this.prompt = q('.island-prompt');
    this.promptTitle = q('.island-prompt-title');
    this.promptText = q('.island-prompt-text');
    this.promptSecret = q('.island-prompt-secret');
    this.promptInput = q('.island-prompt-input');
    this.promptConfirm = q('.island-prompt-confirm');
    this.promptCancel = q('.island-prompt-cancel');
  }

  init(): void {
    this.panel.inert = true;
    this.prompt.inert = true;
    const confirm = () => {
      if (!this.promptConfirm.disabled) this.promptOptions?.confirm(this.promptInput.value);
    };
    this.promptConfirm.addEventListener('click', confirm);
    this.promptCancel.addEventListener('click', () => this.promptOptions?.cancel());
    this.prompt.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && evt.target === this.promptInput) {
        evt.preventDefault();
        confirm();
      } else if (evt.key === 'Escape' && this.promptOptions?.dismissible) {
        evt.preventDefault();
        this.promptOptions.cancel();
      }
    });
    this.prompt.addEventListener('animationend', () => this.prompt.classList.remove('rejected'));

    this.saveBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.host.run('save');
    });

    // Keep focus where it was (usually the editor) when the pill is clicked.
    this.hint.addEventListener('mousedown', (evt) => evt.preventDefault());

    this.root.addEventListener('click', (evt) => {
      const target = evt.target as Node;
      // Row clicks close the palette before bubbling here; never reopen for them.
      if (this.isOpen() || this.isPrompting()) return;
      // A prompt button may have just folded the prompt: that click is not for the pill.
      if (this.prompt.contains(target)) return;
      if (this.saveBtn.contains(target) || this.panel.contains(target)) return;
      this.open();
    });

    document.addEventListener('pointerdown', (evt) => {
      if (this.isOpen() && !this.root.contains(evt.target as Node)) this.close(false);
    });

    // Last pointer position, to tell on close whether it will still be over the folded pill.
    document.addEventListener(
      'pointermove',
      (evt) => {
        this.pointer = { x: evt.clientX, y: evt.clientY };
      },
      { passive: true }
    );

    window.addEventListener(
      'keydown',
      (evt) => {
        // The question has to be answered: no palette or commands meanwhile.
        if (this.isPrompting()) return;
        if (isPaletteShortcut(evt)) {
          evt.preventDefault();
          this.toggle();
          return;
        }
        const id = shortcutCommand(evt, this.host.context());
        if (id === null) return;
        evt.preventDefault();
        if (evt.repeat && !id.startsWith('zoom')) return;
        this.runShortcut(id);
      },
      true
    );

    this.input.addEventListener('keydown', (evt) => this.onInputKey(evt));
    this.input.addEventListener('input', () => this.onInputChange());

    this.list.addEventListener('mousemove', (evt) => {
      const index = this.rowIndexOf(evt.target);
      if (index !== -1 && index !== this.selected && !this.rows[index]?.disabled)
        this.select(index);
    });
    this.list.addEventListener('click', (evt) => {
      const index = this.rowIndexOf(evt.target);
      if (index !== -1) this.activate(index, { shiftKey: evt.shiftKey });
    });
  }

  /** Run a command from its key: prefix and submenu commands open the palette there. */
  private runShortcut(id: string): void {
    const cmd = availableCommands(this.host.context()).find((c) => c.id === id);
    if (cmd?.submenu) {
      this.open();
      this.setMenu(id);
    } else if (cmd?.prefill !== undefined) {
      this.open();
      this.setInput(cmd.prefill);
    } else {
      this.close(false);
      this.host.run(id);
    }
  }

  isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  isPrompting(): boolean {
    return this.root.classList.contains('prompting');
  }

  /**
   * Morph the pill into a question with two answers. It stays until
   * hidePrompt: outside clicks and the palette shortcut do nothing, nor does
   * Escape unless the question is dismissible.
   * On first load the pill fades in first, then morphs, so the change from
   * the familiar pill reads as the app asking.
   */
  showPrompt(options: PromptOptions): void {
    this.close(false);
    this.promptOptions = options;
    this.promptTitle.textContent = options.title;
    this.promptText.textContent = options.text;
    this.promptSecret.hidden = options.secret === undefined;
    this.promptSecret.textContent = options.secret ?? '';
    this.promptInput.hidden = options.input === undefined;
    this.promptInput.value = '';
    this.promptInput.placeholder = options.input?.placeholder ?? '';
    if (options.input) this.promptInput.setAttribute('aria-label', options.input.label);
    this.promptCancel.textContent = options.cancelLabel;
    this.setPromptBusy(false);
    if (this.isPrompting()) {
      // Already asking: the new question replaces the old one in place.
      this.root.style.width = `${this.prompt.offsetWidth}px`;
      this.root.style.height = `${this.prompt.offsetHeight}px`;
      this.focusPrompt();
      return;
    }
    const token = ++this.promptToken;
    const fresh = !this.root.hasAttribute('data-settled');
    this.settle();
    const morph = () => {
      if (token !== this.promptToken) return;
      if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);
      this.root.style.width = `${this.root.offsetWidth}px`;
      this.root.style.height = `${this.root.offsetHeight}px`;
      void this.root.offsetWidth;
      this.root.classList.add('prompting');
      this.prompt.inert = false;
      this.root.style.width = `${this.prompt.offsetWidth}px`;
      this.root.style.height = `${this.prompt.offsetHeight}px`;
      this.focusPrompt();
    };
    // Two frames: the first paints the settled pill, the second starts the morph.
    if (fresh) requestAnimationFrame(() => requestAnimationFrame(morph));
    else morph();
  }

  private focusPrompt(): void {
    const target = this.promptInput.hidden ? this.promptConfirm : this.promptInput;
    target.focus({ preventScroll: true });
  }

  /** Fold the question back into the pill. */
  hidePrompt(): void {
    this.promptToken++;
    this.promptOptions = null;
    if (!this.isPrompting()) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.prompt.contains(focused)) focused.blur();
    this.promptInput.value = '';
    this.root.classList.remove('prompting');
    this.prompt.inert = true;
    this.fold();
  }

  /** While the answer is being acted on: buttons and field off, confirm says so. */
  setPromptBusy(busy: boolean): void {
    const options = this.promptOptions;
    this.promptConfirm.disabled = busy;
    this.promptCancel.disabled = busy;
    this.promptInput.readOnly = busy;
    if (options) {
      this.promptConfirm.textContent =
        busy && options.busyLabel ? options.busyLabel : options.confirmLabel;
    }
  }

  /** The answer was wrong: a short shake, and the field is ready for another try. */
  rejectPrompt(): void {
    this.setPromptBusy(false);
    this.prompt.classList.remove('rejected');
    void this.prompt.offsetWidth; // restart the animation
    this.prompt.classList.add('rejected');
    if (!this.promptInput.hidden) {
      this.promptInput.focus({ preventScroll: true });
      this.promptInput.select();
    }
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen()) return;
    this.prevFocus = document.activeElement;
    if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);
    this.root.classList.remove('hover-off');

    // Pin the folded size so the morph has a numeric start value.
    this.root.style.width = `${this.root.offsetWidth}px`;
    this.root.style.height = `${this.root.offsetHeight}px`;
    void this.root.offsetWidth;

    this.root.classList.add('open');
    this.panel.inert = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-expanded', 'true');

    // Every invocation starts fresh: root menu, empty query, first row.
    this.menu = null;
    this.input.value = '';
    this.findStatus = { current: 0, total: 0 };
    this.selected = 0;
    this.list.scrollTop = 0;
    this.render();
    this.input.focus({ preventScroll: true });
    this.openedCallbacks.forEach((cb) => cb());
  }

  close(restoreFocus = true): void {
    if (!this.isOpen()) return;
    this.host.clearFind();

    this.input.blur();
    this.root.classList.remove('open');
    this.panel.inert = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-expanded', 'false');

    // Restore focus before measuring: focus back on the trigger also expands the pill.
    const prev = this.prevFocus;
    this.prevFocus = null;
    if (restoreFocus && prev instanceof HTMLElement && prev.isConnected && prev !== document.body) {
      prev.focus({ preventScroll: true });
    }

    this.fold();
  }

  /** Animate back to the folded content size, then return to auto sizing. */
  private fold(): void {
    // The open panel is much larger than the pill: a pointer over it "hovers"
    // now but will be outside once folded. Fold straight to the plain pill
    // then, with hover styling off until the fold is done, instead of to the
    // hover pill and again once the hover ends.
    let folded = this.foldedSize();
    if (this.root.matches(':hover') && !this.pointerInFolded(folded)) {
      this.root.classList.add('hover-off');
      folded = this.foldedSize();
    }
    this.root.style.width = `${folded.width}px`;
    this.root.style.height = `${folded.height}px`;
    const release = () => {
      if (this.isOpen() || this.isPrompting()) return;
      this.root.classList.remove('hover-off');
      this.root.style.width = '';
      this.root.style.height = '';
    };
    const onEnd = (evt: TransitionEvent) => {
      if (evt.target !== this.root || evt.propertyName !== 'width') return;
      this.root.removeEventListener('transitionend', onEnd);
      release();
    };
    this.root.addEventListener('transitionend', onEnd);
    this.collapseTimer = setTimeout(() => {
      this.root.removeEventListener('transitionend', onEnd);
      release();
    }, COLLAPSE_FALLBACK_MS);
  }

  /** Whether the last pointer position lies inside the pill once folded to `size`. */
  private pointerInFolded(size: { width: number; height: number }): boolean {
    if (!this.pointer) return false;
    const rect = this.root.getBoundingClientRect(); // right-anchored: right and top stay put
    const { x, y } = this.pointer;
    return (
      x >= rect.right - size.width &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.top + size.height
    );
  }

  /**
   * The size the folded pill is about to settle at. Its slide-out parts only
   * start transitioning once `.open` is gone (e.g. the keycap re-expanding
   * under a pointer that is still over the island), so a plain read returns
   * their collapsed start values: the pill would shrink to the bare mark and
   * then grow again. Reading with those transitions off gives the end state.
   */
  private foldedSize(): { width: number; height: number } {
    this.hint.classList.add('is-measuring');
    const size = { width: this.hint.offsetWidth, height: this.hint.offsetHeight };
    this.hint.classList.remove('is-measuring');
    return size;
  }

  setMode(mode: ViewMode): void {
    this.root.dataset.mode = mode;
  }

  /**
   * Save chip label: "Save" plus an optional monochrome icon for the
   * non-default save option (clock for a lifetime, flame for burn).
   * `spoken` carries the details, as accessible name and hover tooltip.
   */
  setSaveLabel(spoken: string, icon: SaveIcon | null): void {
    const current = this.saveBtn.querySelector<SVGSVGElement>('.island-save-icon');
    if ((current?.dataset.icon ?? null) !== icon) {
      this.saveBtn.textContent = 'Save';
      if (icon) this.saveBtn.appendChild(saveIcon(icon));
    }
    if (spoken === 'Save') {
      this.saveBtn.removeAttribute('aria-label');
      this.saveBtn.removeAttribute('title');
    } else {
      this.saveBtn.setAttribute('aria-label', spoken);
      this.saveBtn.title = spoken;
    }
  }

  setSaveEnabled(enabled: boolean): void {
    this.saveBtn.disabled = !enabled;
    this.saveBtn.setAttribute('aria-hidden', String(!enabled));
  }

  setStage(stage: HintStage): void {
    this.root.dataset.stage = stage;
  }

  /**
   * Reveal the island and enable state animations. Call once the initial
   * state has been applied: the forced layout commits that state while
   * transitions are still off, so only the island's fade-in animates.
   */
  settle(): void {
    if (this.root.hasAttribute('data-settled')) return;
    void this.root.offsetWidth;
    this.root.dataset.settled = '';
    this.root.style.removeProperty('visibility'); // hidden in the markup
  }

  /** Register a callback fired every time the palette opens. */
  onOpened(cb: () => void): void {
    this.openedCallbacks.push(cb);
  }

  // --- input handling -------------------------------------------------------

  private onInputChange(): void {
    const query = parseQuery(this.input.value);
    if (this.menu === null && query.kind === 'find' && this.host.context().mode === 'presenting') {
      this.findStatus = this.host.find(query.text, 0);
    } else if (this.findStatus.total > 0 || this.findStatus.current > 0) {
      this.host.clearFind();
      this.findStatus = { current: 0, total: 0 };
    }
    this.selected = 0;
    this.render();
  }

  private onInputKey(evt: KeyboardEvent): void {
    switch (evt.key) {
      case 'ArrowDown':
        evt.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        evt.preventDefault();
        this.move(-1);
        break;
      case 'Tab':
        evt.preventDefault();
        this.move(evt.shiftKey ? -1 : 1);
        break;
      case 'PageDown':
      case 'PageUp':
        evt.preventDefault();
        this.page(evt.key === 'PageDown' ? 1 : -1);
        break;
      case 'Home':
      case 'End':
        // The list owns Home/End (the query is short; Left/Right still move the
        // caret). Shift+Home/End keep selecting text in the query.
        if (evt.shiftKey) break;
        evt.preventDefault();
        this.jump(evt.key === 'Home' ? 1 : -1);
        break;
      case 'Enter':
        evt.preventDefault();
        this.activate(this.selected, { shiftKey: evt.shiftKey });
        break;
      case 'Escape':
        evt.preventDefault();
        evt.stopPropagation();
        this.close();
        break;
      case 'Backspace':
        if (this.menu !== null && this.input.value === '') {
          evt.preventDefault();
          this.setMenu(null);
        }
        break;
    }
  }

  private setInput(value: string): void {
    this.input.value = value;
    this.input.setSelectionRange(value.length, value.length);
    this.onInputChange();
  }

  private setMenu(menu: string | null): void {
    this.menu = menu;
    this.menuItems = menu === null ? [] : this.host.submenu(menu);
    this.input.value = '';
    this.selected = 0;
    this.render();
  }

  // --- rows -----------------------------------------------------------------

  private buildRows(): Row[] {
    const ctx = this.host.context();
    const text = this.input.value;

    if (this.menu !== null) {
      const menuId = this.menu;
      const items = rankItems(this.menuItems, text, itemTexts);
      return items.map((item) => ({
        label: item.label,
        hint: item.hint,
        action: () => {
          this.close();
          this.host.runSubmenu(menuId, item.id);
        },
      }));
    }

    const query = parseQuery(text);

    if (query.kind === 'line') {
      if (query.line === null) return [{ label: 'Type a line number', disabled: true }];
      const line = query.line;
      return [
        {
          label: `Go to line ${line}`,
          hint: 'Enter',
          action: () => {
            this.close(ctx.mode !== 'editing');
            this.host.goToLine(line);
          },
        },
      ];
    }

    if (query.kind === 'find') {
      if (ctx.mode !== 'presenting') {
        return [{ label: 'Find works while viewing a paste', disabled: true }];
      }
      if (query.text === '') return [{ label: 'Type text to find', disabled: true }];
      const { current, total } = this.findStatus;
      return [
        {
          label: `Find "${query.text}"`,
          hint: total === 0 ? 'No matches' : `${current}/${total}`,
          action: ({ shiftKey }) => {
            if (this.findStatus.total > 0) {
              this.findStatus = this.host.find(query.text, shiftKey ? -1 : 1);
            }
            return true;
          },
        },
      ];
    }

    let commands = rankItems(availableCommands(ctx), query.text, itemTexts);
    // Unfiltered, list what can run first; greyed-out commands follow.
    if (query.text === '')
      commands = [...commands.filter((c) => !c.disabled), ...commands.filter((c) => c.disabled)];
    const rows: Row[] = commands.map((cmd) => ({
      label: cmd.label,
      hint: cmd.hint,
      icon: cmd.icon,
      disabled: cmd.disabled,
      action: () => {
        if (cmd.submenu) {
          this.setMenu(cmd.id);
          return true;
        }
        if (cmd.prefill !== undefined) {
          this.setInput(cmd.prefill);
          return true;
        }
        this.close();
        this.host.run(cmd.id);
        return false;
      },
    }));

    if (ctx.mode === 'presenting' && query.text !== '') {
      const findText = query.text;
      rows.push({
        label: `Find "${findText}"`,
        hint: '?',
        action: () => {
          this.setInput(`?${findText}`);
          return true;
        },
      });
    }
    return rows;
  }

  private render(): void {
    this.rows = this.buildRows();
    if (this.selected >= this.rows.length) this.selected = Math.max(this.rows.length - 1, 0);
    if (this.rows[this.selected]?.disabled) this.selected = this.nearestEnabled(this.selected, 1);

    const inMenu = this.menu !== null;
    this.crumb.hidden = !inMenu;
    this.crumb.textContent = inMenu ? (MENU_TITLES[this.menu!] ?? this.menu!) : '';
    this.input.placeholder = inMenu ? 'Filter' : ROOT_PLACEHOLDER;

    const frag = document.createDocumentFragment();
    if (this.rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'island-empty';
      empty.textContent = inMenu && this.menu === 'recent' ? 'No recent pastes' : 'No matches';
      frag.appendChild(empty);
    }
    this.rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'island-row';
      el.id = `island-opt-${i}`;
      el.setAttribute('role', 'option');
      el.dataset.index = String(i);
      if (row.disabled) el.setAttribute('aria-disabled', 'true');
      const label = document.createElement('span');
      label.textContent = row.label;
      el.appendChild(label);
      if (row.icon) {
        el.appendChild(saveIcon(row.icon));
      } else if (row.hint) {
        const kbd = document.createElement('kbd');
        kbd.textContent = row.hint;
        el.appendChild(kbd);
      }
      frag.appendChild(el);
    });
    this.list.textContent = '';
    this.list.appendChild(frag);
    this.select(this.selected);

    if (this.isOpen()) {
      this.root.style.width = `${this.panel.offsetWidth}px`;
      this.root.style.height = `${this.panel.offsetHeight}px`;
    }
  }

  private select(index: number): void {
    this.selected = index;
    const options = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    options.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    const current = options[index];
    if (current) {
      this.input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private move(delta: 1 | -1): void {
    if (this.rows.length === 0) return;
    const next = this.nearestEnabled(this.selected + delta, delta);
    if (!this.rows[next]?.disabled) this.select(next);
  }

  /** Move by one visible page of rows (less one, so the edge row stays in view). */
  private page(direction: 1 | -1): void {
    if (this.rows.length === 0) return;
    const row = this.list.querySelector<HTMLElement>('[role="option"]');
    const perPage = row
      ? Math.max(1, Math.floor(this.list.clientHeight / row.offsetHeight) - 1)
      : 1;
    this.selectNearest(this.selected + direction * perPage, direction);
  }

  /** Select the first (1) or last (-1) enabled row. */
  private jump(direction: 1 | -1): void {
    if (this.rows.length === 0) return;
    this.selectNearest(direction === 1 ? 0 : this.rows.length - 1, direction);
  }

  /** Select the enabled row nearest `target`, looking in `direction` first. */
  private selectNearest(target: number, direction: 1 | -1): void {
    let next = this.nearestEnabled(target, direction);
    if (this.rows[next]?.disabled) next = this.nearestEnabled(target, direction === 1 ? -1 : 1);
    if (!this.rows[next]?.disabled) this.select(next);
  }

  /** First enabled row from `start` in `direction`; `start` (clamped) if there is none. */
  private nearestEnabled(start: number, direction: 1 | -1): number {
    const last = this.rows.length - 1;
    const from = Math.min(Math.max(start, 0), last);
    for (let i = from; i >= 0 && i <= last; i += direction) {
      if (!this.rows[i].disabled) return i;
    }
    return from;
  }

  private activate(index: number, evt: { shiftKey: boolean }): void {
    const row = this.rows[index];
    if (!row || row.disabled || !row.action) return;
    const keepOpen = row.action(evt);
    if (keepOpen && this.isOpen()) this.render();
  }

  private rowIndexOf(target: EventTarget | null): number {
    const el = (target as Element | null)?.closest?.('.island-row') as HTMLElement | null;
    return el ? parseInt(el.dataset.index ?? '-1', 10) : -1;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export type SaveIcon = NonNullable<PaletteItem['icon']>;

/** Outline paths in a 10x12 box, stroked in currentColor. */
const SAVE_ICON_PATHS: Record<SaveIcon, string[]> = {
  clock: ['M5 2.4 A4.1 4.1 0 1 0 5 10.6 A4.1 4.1 0 1 0 5 2.4 Z', 'M5 4.3 V6.6 L6.6 7.6'],
  burn: [
    'M5 0.9 C5.4 3 8.6 4.6 8.6 7.6 A3.6 3.6 0 0 1 1.4 7.6 C1.4 6 2.2 4.9 3.1 4.2 ' +
      'C3.2 5.5 3.8 6.3 4.5 6.4 C4.4 4.6 4.2 2.6 5 0.9 Z',
  ],
  lock: ['M1.6 5.6 H8.4 V10.9 H1.6 Z', 'M3.1 5.6 V3.9 A1.9 1.9 0 0 1 6.9 3.9 V5.6'],
};

function saveIcon(kind: SaveIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'island-save-icon');
  svg.dataset.icon = kind;
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 10 12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of SAVE_ICON_PATHS[kind]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function itemTexts(item: PaletteItem): string[] {
  return [item.label, ...(item.keywords ?? [])];
}

/** Ctrl+/ on any layout: match the physical Slash key or a typed "/". */
export function isPaletteShortcut(evt: KeyboardEvent): boolean {
  return evt.ctrlKey && !evt.altKey && !evt.metaKey && (evt.code === 'Slash' || evt.key === '/');
}
