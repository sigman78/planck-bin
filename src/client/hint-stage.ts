/**
 * Hint stage - how loudly the island advertises the command palette.
 *
 *   first  "commands Ctrl /" with a soft pulse (first visit)
 *   learn  keycap stays visible until the palette is opened once
 *   known  mark only; hover reveals the keycap
 *
 * Stages only move forward. Without storage the island stays at "learn":
 * discoverable, but never nagging with the first-visit text.
 */

export type HintStage = 'first' | 'learn' | 'known';
export type HintEvent = 'timeout' | 'input' | 'open';

const STAGE_KEY = 'haste-hint-stage';
const ORDER: HintStage[] = ['first', 'learn', 'known'];

export function advanceStage(current: HintStage, event: HintEvent): HintStage {
  if (event === 'open') return 'known';
  return current === 'first' ? 'learn' : current;
}

const isStage = (value: unknown): value is HintStage => ORDER.includes(value as HintStage);

export class HintStageStore {
  load(): HintStage {
    try {
      const stored = localStorage.getItem(STAGE_KEY);
      return isStage(stored) ? stored : 'first';
    } catch {
      return 'learn';
    }
  }

  save(stage: HintStage): void {
    if (ORDER.indexOf(stage) < ORDER.indexOf(this.load())) return;
    try {
      localStorage.setItem(STAGE_KEY, stage);
    } catch {
      // best-effort
    }
  }
}
