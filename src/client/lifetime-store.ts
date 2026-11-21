/**
 * The paste lifetime picked in the palette ("Expires"), remembered per
 * browser. null = the server default (DEFAULT_EXPIRE_DAYS). Best-effort:
 * without storage the choice lasts for the tab only.
 */

import { isLifetimeId, type LifetimeId } from '../shared/types';

const LIFETIME_KEY = 'haste-lifetime';

export class LifetimeStore {
  load(): LifetimeId | null {
    try {
      const stored = localStorage.getItem(LIFETIME_KEY);
      return isLifetimeId(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  save(lifetime: LifetimeId | null): void {
    try {
      if (lifetime === null) localStorage.removeItem(LIFETIME_KEY);
      else localStorage.setItem(LIFETIME_KEY, lifetime);
    } catch {
      // best-effort
    }
  }
}
