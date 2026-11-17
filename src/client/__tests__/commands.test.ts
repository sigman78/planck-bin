import { availableCommands, shortcutCommand, type CommandContext, type KeyLike } from '../commands';

const base: CommandContext = {
  mode: 'presenting',
  canSave: false,
  frozen: false,
  hasKey: true,
  enableTwitter: true,
  isMac: false,
};

const ids = (ctx: Partial<CommandContext>) =>
  availableCommands({ ...base, ...ctx }).map((c) => c.id);

describe('availableCommands', () => {
  it('offers paste actions while presenting', () => {
    expect(ids({})).toEqual([
      'save',
      'new',
      'duplicate',
      'copy-link',
      'raw',
      'find',
      'goto-line',
      'language',
      'recent',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
      'twitter',
      'about',
    ]);
  });

  it('always lists save, enabled only while editing with content', () => {
    const save = (ctx: Partial<CommandContext>) =>
      availableCommands({ ...base, ...ctx }).find((c) => c.id === 'save')!;
    expect(save({ mode: 'editing', canSave: true }).disabled).toBe(false);
    expect(save({ mode: 'editing', canSave: false }).disabled).toBe(true);
    expect(save({ mode: 'presenting', canSave: true }).disabled).toBe(true);
    expect(
      availableCommands(base)
        .filter((c) => c.disabled)
        .map((c) => c.id)
    ).toEqual(['save']);
  });

  it('hides presenting-only commands while editing', () => {
    const editing = ids({ mode: 'editing', canSave: true });
    for (const id of ['duplicate', 'copy-link', 'raw', 'find', 'language', 'twitter']) {
      expect(editing).not.toContain(id);
    }
    expect(editing).toEqual(expect.arrayContaining(['new', 'goto-line', 'recent', 'about']));
  });

  it('hides duplicate and raw for frozen documents but keeps copy link', () => {
    const frozen = ids({ frozen: true });
    expect(frozen).not.toContain('duplicate');
    expect(frozen).not.toContain('raw');
    expect(frozen).toContain('copy-link');
  });

  it('hides raw without a key', () => {
    expect(ids({ hasKey: false })).not.toContain('raw');
  });

  it('hides twitter when disabled', () => {
    expect(ids({ enableTwitter: false })).not.toContain('twitter');
  });

  it('hints Ctrl/Cmd+S for save and Alt/Opt+Shift keys for the rest', () => {
    const hints = (isMac: boolean) =>
      Object.fromEntries(availableCommands({ ...base, isMac }).map((c) => [c.id, c.hint]));
    expect(hints(false).save).toBe('Ctrl+S');
    expect(hints(true).save).toBe('Cmd+S');
    expect(hints(false)).toMatchObject({
      new: 'Alt+Shift+P',
      duplicate: 'Alt+Shift+D',
      'copy-link': 'Alt+Shift+C',
      raw: 'Alt+Shift+R',
      find: 'Alt+Shift+F',
      'goto-line': 'Alt+Shift+G',
      language: 'Alt+Shift+L',
      recent: 'Alt+Shift+H',
      'zoom-in': 'Alt+Shift+=',
      'zoom-out': 'Alt+Shift+-',
      'zoom-reset': 'Alt+Shift+0',
      twitter: 'Alt+Shift+X',
    });
    expect(hints(true).duplicate).toBe('Opt+Shift+D');
    expect(hints(false).about).toBeUndefined();
  });

  it('marks prefill and submenu commands', () => {
    const all = availableCommands(base);
    expect(all.find((c) => c.id === 'goto-line')!.prefill).toBe(':');
    expect(all.find((c) => c.id === 'find')!.prefill).toBe('?');
    expect(all.find((c) => c.id === 'language')!.submenu).toBe(true);
    expect(all.find((c) => c.id === 'recent')!.submenu).toBe(true);
  });
});

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});
const altShift = (code: string) => key(code, { altKey: true, shiftKey: true });

describe('shortcutCommand', () => {
  it('maps Alt/Opt+Shift keys to available commands on every platform', () => {
    expect(shortcutCommand(altShift('KeyD'), base)).toBe('duplicate');
    expect(shortcutCommand(altShift('KeyD'), { ...base, isMac: true })).toBe('duplicate');
    expect(shortcutCommand(altShift('KeyP'), base)).toBe('new');
    expect(shortcutCommand(altShift('Equal'), base)).toBe('zoom-in');
    expect(shortcutCommand(altShift('KeyL'), base)).toBe('language');
  });

  it('leaves browser-claimed and unbound keys alone', () => {
    for (const code of ['KeyN', 'KeyI', 'KeyA', 'KeyT', 'KeyQ']) {
      expect(shortcutCommand(altShift(code), base)).toBeNull();
    }
    expect(shortcutCommand(key('KeyD', { altKey: true }), base)).toBeNull();
    expect(
      shortcutCommand(key('KeyD', { altKey: true, shiftKey: true, ctrlKey: true }), base)
    ).toBeNull();
  });

  it('only claims a key while its command can run', () => {
    const editing = { ...base, mode: 'editing' as const };
    expect(shortcutCommand(altShift('KeyD'), editing)).toBeNull(); // duplicate: presenting only
    expect(shortcutCommand(altShift('KeyR'), { ...base, frozen: true })).toBeNull();
    expect(shortcutCommand(altShift('KeyP'), editing)).toBe('new');
  });

  it('saves with Ctrl+S / Ctrl+Enter, or Cmd on Mac', () => {
    expect(shortcutCommand(key('KeyS', { ctrlKey: true }), base)).toBe('save');
    expect(shortcutCommand(key('Enter', { ctrlKey: true }), base)).toBe('save');
    expect(shortcutCommand(key('KeyS', { metaKey: true }), base)).toBeNull();
    const mac = { ...base, isMac: true };
    expect(shortcutCommand(key('KeyS', { metaKey: true }), mac)).toBe('save');
    expect(shortcutCommand(key('NumpadEnter', { metaKey: true }), mac)).toBe('save');
    expect(shortcutCommand(key('KeyS', { ctrlKey: true }), mac)).toBeNull();
    expect(shortcutCommand(key('KeyL', { ctrlKey: true }), base)).toBeNull(); // address bar stays
  });
});
