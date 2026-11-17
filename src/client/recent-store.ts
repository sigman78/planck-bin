/**
 * RecentStore - pastes this browser recently created or opened.
 *
 * Local-only (localStorage), capped and best-effort: storage errors and
 * malformed data simply yield an empty list.
 */

export interface RecentEntry {
  key: string;
  path: string;
  preview: string;
  at: number;
}

const RECENT_KEY = 'haste-recent';
export const RECENT_LIMIT = 15;
const PREVIEW_LENGTH = 60;

function previewOf(content: string, key: string): string {
  const line = content.split('\n').find((l) => l.trim() !== '');
  return line ? line.trim().slice(0, PREVIEW_LENGTH) : key;
}

function isEntry(value: unknown): value is RecentEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.key === 'string' &&
    typeof e.path === 'string' &&
    typeof e.preview === 'string' &&
    typeof e.at === 'number'
  );
}

export class RecentStore {
  list(): RecentEntry[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  record(key: string, path: string, content: string, now: number = Date.now()): void {
    const entry: RecentEntry = { key, path, preview: previewOf(content, key), at: now };
    const rest = this.list().filter((e) => e.key !== key);
    this.write([entry, ...rest].slice(0, RECENT_LIMIT));
  }

  remove(key: string): void {
    this.write(this.list().filter((e) => e.key !== key));
  }

  clear(): void {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // best-effort
    }
  }

  private write(entries: RecentEntry[]): void {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
    } catch {
      // best-effort
    }
  }
}
