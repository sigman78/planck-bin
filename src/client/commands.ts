/**
 * Commands - the command palette's command table.
 *
 * Pure data: each command has an id, label, optional shortcut hint and an
 * availability rule. AppController maps ids to behaviour.
 */

import type { BurnState } from './paste';

export type ViewMode = 'editing' | 'presenting';

/** A modifier key as drawn in the palette: Cmd and Opt are the Mac keys. */
export type ModifierKey = 'ctrl' | 'cmd' | 'alt' | 'opt' | 'shift';

/** A key combination in display form: modifiers in order, then the main key. */
export interface Shortcut {
  mods: ModifierKey[];
  key: string;
}

export const MODIFIER_NAMES: Record<ModifierKey, string> = {
  ctrl: 'Ctrl',
  cmd: 'Cmd',
  alt: 'Alt',
  opt: 'Opt',
  shift: 'Shift',
};

/** The shortcut as text, e.g. "Alt+Shift+P". */
export function shortcutLabel(shortcut: Shortcut): string {
  return [...shortcut.mods.map((m) => MODIFIER_NAMES[m]), shortcut.key].join('+');
}

export interface PaletteItem {
  id: string;
  label: string;
  /** Text at the row's end; for a command with a shortcut, the shortcut as text. */
  hint?: string;
  /** Key combination that runs the item, drawn as key caps in place of the hint text. */
  shortcut?: Shortcut;
  /** Monochrome state icon shown in place of the hint (see saveIcon). */
  icon?: 'clock' | 'burn' | 'lock';
  keywords?: string[];
  /** The menu opens with this item selected (the value in effect). */
  current?: boolean;
  /** Listed but not runnable in this context (shown greyed out). */
  disabled?: boolean;
}

export interface Command extends PaletteItem {
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
  /** Burn state of the paste on screen. */
  burn?: BurnState;
  /** The next save is burn-after-reading. */
  burnNext?: boolean;
  /** Lifetime the next save asks for, e.g. "1 week" or "default". */
  lifetimeLabel?: string;
  /** Name of the color theme on screen. */
  themeLabel?: string;
  /** The paste on screen is protected: behind the passphrase gate, or opened. */
  lock?: 'pending' | 'open';
  /** The next save is protected with a passphrase. */
  lockNext?: boolean;
  /** The passphrase of the paste on screen is known here (its creator, this tab). */
  hasPassphrase?: boolean;
  /** A preview mode can present the paste on screen: its label, and whether it is on. */
  preview?: { label: string; on: boolean };
  /** Sign-in is configured on this server. */
  authEnabled?: boolean;
  /** Display name of the signed-in user; undefined when signed out. */
  userName?: string;
  /** The next save is private (signed in only). */
  privateNext?: boolean;
  /** The signed-in user created the paste on screen. */
  mine?: boolean;
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
  /** Fixed, or computed so a toggle names the action it will perform. */
  label: string | ((ctx: CommandContext) => string);
  keywords?: string[];
  /** Alt/Opt+Shift + this key runs the command. */
  key?: ShortcutKey;
  /** Cmd (Mac) / Ctrl + this key runs the command; display only, see shortcutCommand. */
  modKey?: string;
  /** Explicit hint text, e.g. the value in effect. Defaults to the shortcut. */
  hint?: (ctx: CommandContext) => string;
  submenu?: boolean;
  prefill?: string;
  icon?: (ctx: CommandContext) => PaletteItem['icon'];
  available: (ctx: CommandContext) => boolean;
  /** Listed even when it cannot run, greyed out. */
  enabled?: (ctx: CommandContext) => boolean;
}

const presenting = (ctx: CommandContext) => ctx.mode === 'presenting';
const editing = (ctx: CommandContext) => ctx.mode === 'editing';
const always = () => true;
const signedIn = (ctx: CommandContext) => ctx.userName !== undefined;
/** Behind a question (burn reveal, passphrase): nothing of the paste is loaded. */
const gated = (ctx: CommandContext) => ctx.burn === 'pending' || ctx.lock === 'pending';

const COMMANDS: CommandDef[] = [
  {
    id: 'save',
    label: 'Save',
    keywords: ['publish', 'share'],
    modKey: 'S',
    available: always,
    enabled: (ctx) => ctx.mode === 'editing' && ctx.canSave,
  },
  // No direct keys: Alt+Shift+letter types symbols in the editor on some layouts.
  {
    id: 'expiry',
    label: 'Expires',
    keywords: ['lifetime', 'ttl', 'duration', 'permanent', 'expiry'],
    hint: (ctx) => ctx.lifetimeLabel ?? 'default',
    submenu: true,
    available: editing,
  },
  {
    id: 'burn',
    // Burn and lifetime are independent server-side, so this is not an Expires preset.
    label: (ctx) => (ctx.burnNext ? "Don't burn after reading" : 'Burn after reading'),
    keywords: ['once', 'one-time', 'ephemeral', 'secret', 'self-destruct', 'destroy', 'keep'],
    icon: (ctx) => (ctx.burnNext ? 'burn' : undefined),
    available: editing,
  },
  {
    id: 'lock',
    label: (ctx) => (ctx.lockNext ? "Don't protect with passphrase" : 'Protect with passphrase'),
    keywords: ['password', 'passphrase', 'encrypt', 'private', 'secret', 'lock', 'own', 'custom'],
    icon: (ctx) => (ctx.lockNext ? 'lock' : undefined),
    available: editing,
  },
  {
    id: 'private',
    // Like burn, a toggle that names the action it will perform.
    label: (ctx) => (ctx.privateNext ? "Don't make private" : 'Make private'),
    keywords: ['private', 'personal', 'only me', 'hidden', 'owner', 'secret'],
    // Shares the passphrase lock: a finer glyph does not read at chip size.
    icon: (ctx) => (ctx.privateNext ? 'lock' : undefined),
    available: (ctx) => editing(ctx) && signedIn(ctx),
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
    available: (ctx) => presenting(ctx) && !ctx.frozen && !gated(ctx),
  },
  {
    id: 'copy-link',
    label: 'Copy link',
    keywords: ['share', 'url', 'clipboard'],
    key: { code: 'KeyC', label: 'C' },
    // A revealed burn paste is gone: its link leads nowhere.
    available: (ctx) => presenting(ctx) && ctx.burn !== 'burned',
  },
  {
    id: 'copy-passphrase',
    label: 'Copy passphrase',
    keywords: ['password', 'secret', 'clipboard', 'share'],
    available: (ctx) => presenting(ctx) && ctx.hasPassphrase === true && ctx.burn !== 'burned',
  },
  {
    id: 'delete',
    label: 'Delete paste',
    keywords: ['remove', 'destroy', 'erase', 'mine'],
    // A revealed burn paste is already gone on the server.
    available: (ctx) =>
      presenting(ctx) && signedIn(ctx) && ctx.mine === true && ctx.burn !== 'burned',
  },
  {
    id: 'raw',
    label: 'View raw',
    keywords: ['plain', 'text', 'download'],
    key: { code: 'KeyR', label: 'R' },
    // /raw reads a burn paste: it would destroy the creator's link, or 404 once burned.
    // A protected one has no readable form on the server.
    available: (ctx) => presenting(ctx) && !ctx.frozen && ctx.hasKey && !ctx.burn && !ctx.lock,
  },
  {
    id: 'preview',
    label: (ctx) => (ctx.preview?.on ? 'Exit preview' : (ctx.preview?.label ?? 'Preview')),
    keywords: ['preview', 'render', 'formatted', 'markdown', 'source', 'view'],
    key: { code: 'KeyV', label: 'V' },
    available: (ctx) => presenting(ctx) && !gated(ctx) && ctx.preview !== undefined,
  },
  {
    id: 'find',
    label: 'Find in paste',
    keywords: ['search'],
    key: { code: 'KeyF', label: 'F' },
    prefill: '?',
    available: (ctx) => presenting(ctx) && !gated(ctx),
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
    available: (ctx) => presenting(ctx) && !gated(ctx),
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
    id: 'mine',
    label: 'My pastes',
    keywords: ['own', 'list', 'account', 'history', 'delete'],
    submenu: true,
    available: signedIn,
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
    available: (ctx) => presenting(ctx) && ctx.enableTwitter && !ctx.burn,
  },
  {
    id: 'theme',
    label: 'Theme',
    keywords: [
      'color',
      'colour',
      'dark',
      'light',
      'appearance',
      'scheme',
      'solarized',
      'github',
      'monokai',
      'one dark',
    ],
    hint: (ctx) => ctx.themeLabel ?? '',
    submenu: true,
    available: always,
  },
  {
    id: 'sign-in',
    label: 'Sign in',
    keywords: ['login', 'log in', 'account', 'oidc'],
    available: (ctx) => ctx.authEnabled === true && !signedIn(ctx),
  },
  {
    id: 'sign-out',
    label: 'Sign out',
    keywords: ['logout', 'log out', 'account'],
    // The only place the signed-in name shows.
    hint: (ctx) => ctx.userName ?? '',
    available: signedIn,
  },
  {
    id: 'about',
    label: 'About',
    keywords: ['help', 'info'],
    available: always,
  },
];

export function availableCommands(ctx: CommandContext): Command[] {
  const mod: ModifierKey = ctx.isMac ? 'cmd' : 'ctrl';
  const alt: ModifierKey = ctx.isMac ? 'opt' : 'alt';
  const shortcutOf = (c: CommandDef): Shortcut | undefined => {
    if (c.modKey) return { mods: [mod], key: c.modKey };
    if (c.key) return { mods: [alt, 'shift'], key: c.key.label };
    return undefined;
  };
  return COMMANDS.filter((c) => c.available(ctx)).map((c) => {
    const shortcut = c.hint ? undefined : shortcutOf(c);
    return {
      id: c.id,
      label: typeof c.label === 'function' ? c.label(ctx) : c.label,
      keywords: c.keywords,
      hint: c.hint?.(ctx) ?? (shortcut && shortcutLabel(shortcut)),
      shortcut,
      disabled: c.enabled ? !c.enabled(ctx) : undefined,
      submenu: c.submenu,
      prefill: c.prefill,
      icon: c.icon?.(ctx),
    };
  });
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
