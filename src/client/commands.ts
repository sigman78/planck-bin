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

interface CommandDef {
  id: string;
  label: string;
  keywords?: string[];
  hint?: (alt: string, zoom: string) => string;
  submenu?: boolean;
  prefill?: string;
  available: (ctx: CommandContext) => boolean;
}

const presenting = (ctx: CommandContext) => ctx.mode === 'presenting';
const always = () => true;

const COMMANDS: CommandDef[] = [
  {
    id: 'save',
    label: 'Save',
    keywords: ['publish', 'share'],
    hint: () => 'Ctrl+S',
    available: (ctx) => ctx.mode === 'editing' && ctx.canSave,
  },
  {
    id: 'new',
    label: 'New paste',
    keywords: ['clear', 'reset', 'blank'],
    hint: (alt) => `${alt}+Shift+N`,
    available: always,
  },
  {
    id: 'duplicate',
    label: 'Duplicate & edit',
    keywords: ['fork', 'copy', 'edit'],
    hint: (alt) => `${alt}+Shift+D`,
    available: (ctx) => presenting(ctx) && !ctx.frozen,
  },
  {
    id: 'copy-link',
    label: 'Copy link',
    keywords: ['share', 'url', 'clipboard'],
    hint: (alt) => `${alt}+Shift+C`,
    available: presenting,
  },
  {
    id: 'raw',
    label: 'View raw',
    keywords: ['plain', 'text', 'download'],
    hint: (alt) => `${alt}+Shift+R`,
    available: (ctx) => presenting(ctx) && !ctx.frozen && ctx.hasKey,
  },
  {
    id: 'find',
    label: 'Find in paste',
    keywords: ['search'],
    hint: () => '/text',
    prefill: '/',
    available: presenting,
  },
  {
    id: 'goto-line',
    label: 'Go to line',
    keywords: ['jump', 'line number'],
    hint: () => ':N',
    prefill: ':',
    available: always,
  },
  {
    id: 'language',
    label: 'Switch language',
    keywords: ['syntax', 'highlight', 'mode'],
    submenu: true,
    available: presenting,
  },
  {
    id: 'recent',
    label: 'Recent pastes',
    keywords: ['history', 'open'],
    submenu: true,
    available: always,
  },
  {
    id: 'zoom-in',
    label: 'Zoom in',
    keywords: ['font', 'bigger'],
    hint: (_alt, zoom) => `${zoom}+=`,
    available: always,
  },
  {
    id: 'zoom-out',
    label: 'Zoom out',
    keywords: ['font', 'smaller'],
    hint: (_alt, zoom) => `${zoom}+-`,
    available: always,
  },
  {
    id: 'zoom-reset',
    label: 'Reset zoom',
    keywords: ['font', 'default'],
    hint: (_alt, zoom) => `${zoom}+0`,
    available: always,
  },
  {
    id: 'twitter',
    label: 'Share on Twitter',
    keywords: ['tweet', 'post'],
    hint: (alt) => `${alt}+Shift+X`,
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
  const alt = ctx.isMac ? 'Opt' : 'Alt';
  const zoom = ctx.isMac ? 'Cmd+Opt' : 'Ctrl+Alt';
  return COMMANDS.filter((c) => c.available(ctx)).map((c) => ({
    id: c.id,
    label: c.label,
    keywords: c.keywords,
    hint: c.hint?.(alt, zoom),
    submenu: c.submenu,
    prefill: c.prefill,
  }));
}
