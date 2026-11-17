/**
 * Palette search - query grammar and fuzzy ranking for the command palette.
 *
 * Grammar:
 *   ":N"    go to line N
 *   "?text" find text in the paste
 *   other   fuzzy filter over command labels and keywords
 */

export type ParsedQuery =
  | { kind: 'line'; line: number | null }
  | { kind: 'find'; text: string }
  | { kind: 'filter'; text: string };

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (trimmed.startsWith(':')) {
    const digits = trimmed.slice(1).trim();
    const line = /^\d+$/.test(digits) ? parseInt(digits, 10) : NaN;
    return { kind: 'line', line: line > 0 ? line : null };
  }
  if (raw.trimStart().startsWith('?')) {
    return { kind: 'find', text: raw.trimStart().slice(1) };
  }
  return { kind: 'filter', text: trimmed };
}

const EXACT_SCORE = 1000;
const PREFIX_SCORE = 500;
const WORD_START_BONUS = 8;
const CONSECUTIVE_BONUS = 5;
const KEYWORD_WEIGHT = 0.8;

function isWordStart(text: string, index: number): boolean {
  return index === 0 || /[\s\-_&./]/.test(text[index - 1]);
}

/**
 * Score how well `query` matches `text` as a case-insensitive subsequence.
 * Returns null when it does not match; higher is better.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === '') return 0;
  if (t === q) return EXACT_SCORE;
  if (t.startsWith(q)) return PREFIX_SCORE + q.length * 10 - (t.length - q.length);

  let score = 0;
  let prev = -2;
  let from = 0;
  for (const ch of q) {
    const index = t.indexOf(ch, from);
    if (index === -1) return null;
    score += 1;
    if (index === prev + 1) score += CONSECUTIVE_BONUS;
    if (isWordStart(t, index)) score += WORD_START_BONUS;
    prev = index;
    from = index + 1;
  }
  return score;
}

/**
 * Filter and rank items by their best-matching text. The first text is the
 * primary label; later texts (keywords) are weighted slightly lower.
 * An empty query keeps the original order. Ties keep the original order.
 */
export function rankItems<T>(items: T[], query: string, textsOf: (item: T) => string[]): T[] {
  const q = query.trim();
  if (q === '') return items.slice();

  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    let best: number | null = null;
    textsOf(item).forEach((text, i) => {
      const s = fuzzyScore(q, text);
      if (s === null) return;
      const weighted = i === 0 ? s : s * KEYWORD_WEIGHT;
      if (best === null || weighted > best) best = weighted;
    });
    if (best !== null) scored.push({ item, score: best, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}
