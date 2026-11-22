/**
 * Markdown sniffing for pastes without a language. highlight.js auto-detect
 * scores "# Heading" lines as Ruby, Python or shell comments, so markdown
 * documents often come out as one of those. This looks for markdown structure
 * (headings at several levels, lists, tables, fences, links) and gives up when
 * many lines look like code, so a script full of # comments stays code.
 */

const SAMPLE_LINES = 400;

const HEADING = /^#{1,6}[ \t]+\S/;
const LIST_ITEM = /^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+\S/;
const TABLE_RULE = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;
const FENCE = /^[ \t]{0,3}(?:```|~~~)/;
const LINK = /\[[^\]\n]+\]\((?:https?:\/\/|\.{0,2}\/|#)[^)\s]*\)/;
const EMPHASIS = /\*\*[^*\n]+\*\*|`[^`\n]+`/;

// Lines that read as code: statements, blocks, assignments, shebangs, nested YAML keys.
const CODE_LINE =
  /^#!|[;{]\s*$|^\s*[}\])]|^\s*(?:def|end|class|import|from|require|function|const|let|var|return|if|elif|else|for|while|fn|package|func|use|module|echo|export|local|then|fi|do|done)\b|^\s*[\w.$[\]]+\s*:?=\s*\S|^\s+[\w-]+:(?:\s|$)/;

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n', SAMPLE_LINES);
  let nonBlank = 0;
  let code = 0;
  let listItems = 0;
  let score = 0;
  let structure = false;
  const headingLevels = new Set<number>();
  let inFence = false;

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      score += 1;
      structure = true;
      continue;
    }
    // Code inside fences is the document's business, not evidence against it.
    if (inFence || line.trim() === '') continue;
    nonBlank++;
    if (HEADING.test(line)) {
      headingLevels.add(/^#+/.exec(line)![0].length);
      continue;
    }
    if (LIST_ITEM.test(line)) listItems++;
    else if (TABLE_RULE.test(line)) {
      score += 2;
      structure = true;
    } else if (CODE_LINE.test(line)) code++;
    if (LINK.test(line)) score += 1;
    if (EMPHASIS.test(line)) score += 1;
  }

  if (nonBlank === 0 || code / nonBlank > 0.2) return false;
  if (headingLevels.size > 0) score += headingLevels.size > 1 ? 3 : 2;
  if (listItems >= 2) score += 1;
  structure ||= headingLevels.size > 0 || listItems >= 2;
  return structure && score >= 3;
}
