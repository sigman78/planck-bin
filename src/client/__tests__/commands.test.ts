import { availableCommands, type CommandContext } from '../commands';

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

  it('offers save only while editing with content', () => {
    expect(ids({ mode: 'editing', canSave: false })).not.toContain('save');
    expect(ids({ mode: 'editing', canSave: true })[0]).toBe('save');
    expect(ids({ mode: 'presenting', canSave: true })).not.toContain('save');
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

  it('uses Alt hints off Mac and Opt hints on Mac', () => {
    const find = (isMac: boolean, id: string) =>
      availableCommands({ ...base, isMac }).find((c) => c.id === id)!;
    expect(find(false, 'new').hint).toBe('Alt+Shift+N');
    expect(find(true, 'new').hint).toBe('Opt+Shift+N');
    expect(find(false, 'zoom-in').hint).toBe('Ctrl+Alt+=');
    expect(find(true, 'zoom-in').hint).toBe('Cmd+Opt+=');
  });

  it('marks prefill and submenu commands', () => {
    const all = availableCommands(base);
    expect(all.find((c) => c.id === 'goto-line')!.prefill).toBe(':');
    expect(all.find((c) => c.id === 'find')!.prefill).toBe('?');
    expect(all.find((c) => c.id === 'language')!.submenu).toBe(true);
    expect(all.find((c) => c.id === 'recent')!.submenu).toBe(true);
  });
});
