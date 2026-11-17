/**
 * Commands - the command palette's command table.
 *
 * Pure data: each command has an id, label, optional shortcut hint and an
 * availability rule. AppController maps ids to behaviour.
 */

export type ViewMode = 'editing' | 'presenting';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
}

export interface Command extends PaletteItem {
  /** Listed but not runnable in this context (shown greyed out). */
  disabled?: boolean;
  /** Opens a nested list instead of running. */
  submenu?: boolean;
  /** Replaces the input with this prefix instead of running (e.g. ":"). */
  prefill?: string;
}

export interface CommandContext {
  mode: ViewMode;
  canSave: boolean;
  frozen: boolean;
  hasKey: boolean;
  enableTwitter: boolean;
  isMac: boolean;
}

/**
 * Direct keys use Alt+Shift (Win/Linux) / Opt+Shift (Mac): the same physical
 * keys, unused by browsers apart from Chrome's I, A, N, T. Matched by physical
 * key (KeyboardEvent.code), so they work on Mac, where Opt+Shift types a
 * symbol, and on non-Latin layouts.
 */
interface ShortcutKey {
  code: string;
  label: string;
}

interface CommandDef {
  id: string;
  label: string;
  keywords?: string[];
  /** Alt/Opt+Shift + this key runs the command. */
  key?: ShortcutKey;
  /** Explicit hint; `mod` is Cmd on Mac, Ctrl elsewhere. Defaults to the key. */
  hint?: (mod: string) => string;
  submenu?: boolean;
  prefill?: string;
  available: (ctx: CommandContext) => boolean;
  /** Listed even when it cannot run, greyed out. */
  enabled?: (ctx: CommandContext) => boolean;
}

const presenting = (ctx: CommandContext) => ctx.mode === 'presenting';
const always = () => true;

const COMMANDS: CommandDef[] = [
  {
    id: 'save',
    label: 'Save',
    keywords: ['publish', 'share'],
    hint: (mod) => `${mod}+S`,
    available: always,
    enabled: (ctx) => ctx.mode === 'editing' && ctx.canSave,
  },
  {
    id: 'new',
    label: 'New paste',
    keywords: ['clear', 'reset', 'blank'],
    key: { code: 'KeyP', label: 'P' }, // N is Chrome's split view
    available: always,
  },
  {
    id: 'duplicate',
    label: 'Duplicate & edit',
    keywords: ['fork', 'copy', 'edit'],
    key: { code: 'KeyD', label: 'D' },
    available: (ctx) => presenting(ctx) && !ctx.frozen,
  },
  {
    id: 'copy-link',
    label: 'Copy link',
    keywords: ['share', 'url', 'clipboard'],
    key: { code: 'KeyC', label: 'C' },
    available: presenting,
  },
  {
    id: 'raw',
    label: 'View raw',
    keywords: ['plain', 'text', 'download'],
    key: { code: 'KeyR', label: 'R' },
    available: (ctx) => presenting(ctx) && !ctx.frozen && ctx.hasKey,
  },
  {
    id: 'find',
    label: 'Find in paste',
    keywords: ['search'],
    key: { code: 'KeyF', label: 'F' },
    prefill: '?',
    available: presenting,
  },
  {
    id: 'goto-line',
    label: 'Go to line',
    keywords: ['jump', 'line number'],
    key: { code: 'KeyG', label: 'G' },
    prefill: ':',
    available: always,
  },
  {
    id: 'language',
    label: 'Switch language',
    keywords: ['syntax', 'highlight', 'mode'],
    key: { code: 'KeyL', label: 'L' },
    submenu: true,
    available: presenting,
  },
  {
    id: 'recent',
    label: 'Recent pastes',
    keywords: ['history', 'open'],
    key: { code: 'KeyH', label: 'H' },
    submenu: true,
    available: always,
  },
  {
    id: 'zoom-in',
    label: 'Zoom in',
    keywords: ['font', 'bigger'],
    key: { code: 'Equal', label: '=' },
    available: always,
  },
  {
    id: 'zoom-out',
    label: 'Zoom out',
    keywords: ['font', 'smaller'],
    key: { code: 'Minus', label: '-' },
    available: always,
  },
  {
    id: 'zoom-reset',
    label: 'Reset zoom',
    keywords: ['font', 'default'],
    key: { code: 'Digit0', label: '0' },
    available: always,
  },
  {
    id: 'twitter',
    label: 'Share on Twitter',
    keywords: ['tweet', 'post'],
    key: { code: 'KeyX', label: 'X' },
    available: (ctx) => presenting(ctx) && ctx.enableTwitter,
  },
  {
    id: 'about',
    label: 'About',
    keywords: ['help', 'info'],
    available: always,
  },
];

export function availableCommands(ctx: CommandContext): Command[] {
  const mod = ctx.isMac ? 'Cmd' : 'Ctrl';
  const alt = ctx.isMac ? 'Opt' : 'Alt';
  return COMMANDS.filter((c) => c.available(ctx)).map((c) => ({
    id: c.id,
    label: c.label,
    keywords: c.keywords,
    hint: c.hint?.(mod) ?? (c.key ? `${alt}+Shift+${c.key.label}` : undefined),
    disabled: c.enabled ? !c.enabled(ctx) : undefined,
    submenu: c.submenu,
    prefill: c.prefill,
  }));
}

export type KeyLike = Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>;

const SAVE_CODES = ['KeyS', 'Enter', 'NumpadEnter'];

/**
 * The command a key press runs, or null. Save is Ctrl+S / Ctrl+Enter (Cmd on
 * Mac) and always claims its keys (no browser "Save page" dialog). Other
 * commands only claim their key while they can run, so e.g. Opt+Shift+D still
 * types its symbol in the editor, where Duplicate is not available.
 */
export function shortcutCommand(evt: KeyLike, ctx: CommandContext): string | null {
  const mod = ctx.isMac ? evt.metaKey && !evt.ctrlKey : evt.ctrlKey && !evt.metaKey;
  if (mod && !evt.altKey && !evt.shiftKey) return SAVE_CODES.includes(evt.code) ? 'save' : null;

  if (!evt.altKey || !evt.shiftKey || evt.ctrlKey || evt.metaKey) return null;
  const def = COMMANDS.find((c) => c.key?.code === evt.code);
  if (!def || !def.available(ctx) || (def.enabled && !def.enabled(ctx))) return null;
  return def.id;
}
