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
  disabled?: boolean;
  /** Runs on Enter/click. Return true to keep the palette open. */
  action?: (evt: { shiftKey: boolean }) => boolean | void;
}

const MENU_TITLES: Record<string, string> = {
  language: 'Language',
  recent: 'Recent',
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

  private menu: string | null = null;
  private menuItems: PaletteItem[] = [];
  private rows: Row[] = [];
  private selected = 0;
  private findStatus: FindStatus = { current: 0, total: 0 };
  private prevFocus: Element | null = null;
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
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
  }

  init(): void {
    this.panel.inert = true;

    this.saveBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.host.run('save');
    });

    // Keep focus where it was (usually the editor) when the pill is clicked.
    this.hint.addEventListener('mousedown', (evt) => evt.preventDefault());

    this.root.addEventListener('click', (evt) => {
      const target = evt.target as Node;
      // Row clicks close the palette before bubbling here; never reopen for them.
      if (this.isOpen() || this.saveBtn.contains(target) || this.panel.contains(target)) return;
      this.open();
    });

    document.addEventListener('pointerdown', (evt) => {
      if (this.isOpen() && !this.root.contains(evt.target as Node)) this.close(false);
    });

    window.addEventListener(
      'keydown',
      (evt) => {
        if (isPaletteShortcut(evt)) {
          evt.preventDefault();
          this.toggle();
        }
      },
      true
    );

    this.input.addEventListener('keydown', (evt) => this.onInputKey(evt));
    this.input.addEventListener('input', () => this.onInputChange());

    this.list.addEventListener('mousemove', (evt) => {
      const index = this.rowIndexOf(evt.target);
      if (index !== -1 && index !== this.selected) this.select(index);
    });
    this.list.addEventListener('click', (evt) => {
      const index = this.rowIndexOf(evt.target);
      if (index !== -1) this.activate(index, { shiftKey: evt.shiftKey });
    });
  }

  isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen()) return;
    this.prevFocus = document.activeElement;
    if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);

    // Pin the folded size so the morph has a numeric start value.
    this.root.style.width = `${this.root.offsetWidth}px`;
    this.root.style.height = `${this.root.offsetHeight}px`;
    void this.root.offsetWidth;

    this.root.classList.add('open');
    this.panel.inert = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-expanded', 'true');

    this.menu = null;
    this.input.value = '';
    this.findStatus = { current: 0, total: 0 };
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

    // Animate back to the folded content size, then return to auto sizing.
    this.root.style.width = `${this.hint.offsetWidth}px`;
    this.root.style.height = `${this.hint.offsetHeight}px`;
    const release = () => {
      if (this.isOpen()) return;
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

    const prev = this.prevFocus;
    this.prevFocus = null;
    if (restoreFocus && prev instanceof HTMLElement && prev.isConnected && prev !== document.body) {
      prev.focus({ preventScroll: true });
    }
  }

  setMode(mode: ViewMode): void {
    this.root.dataset.mode = mode;
  }

  setSaveEnabled(enabled: boolean): void {
    this.saveBtn.disabled = !enabled;
    this.saveBtn.setAttribute('aria-hidden', String(!enabled));
  }

  setStage(stage: HintStage): void {
    this.root.dataset.stage = stage;
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

    const rows: Row[] = rankItems(availableCommands(ctx), query.text, itemTexts).map((cmd) => ({
      label: cmd.label,
      hint: cmd.hint,
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
      if (row.hint) {
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

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.select(Math.min(Math.max(this.selected + delta, 0), this.rows.length - 1));
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

function itemTexts(item: PaletteItem): string[] {
  return [item.label, ...(item.keywords ?? [])];
}

/** Ctrl+/ on any layout: match the physical Slash key or a typed "/". */
export function isPaletteShortcut(evt: KeyboardEvent): boolean {
  return evt.ctrlKey && !evt.altKey && !evt.metaKey && (evt.code === 'Slash' || evt.key === '/');
}
