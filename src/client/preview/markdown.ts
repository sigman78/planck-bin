/**
 * Markdown preview: CommonMark + GFM tables, strikethrough, autolinks and
 * task lists (markdown-it). Raw HTML in the paste is escaped (html: false),
 * and markdown-it refuses javascript:, vbscript: and most data: links itself;
 * the sanitizer then checks everything again.
 *
 * Images become links: the CSP blocks remote images (they would also tell the
 * image host who reads the paste), so a link with the alt text is shown.
 */

import MarkdownIt from 'markdown-it';
import { tasklist } from '@mdit/plugin-tasklist';
import type { PreviewRenderer } from './types';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  // Deeply nested lists and quotes cost time and stack; real documents stay far below.
  maxNesting: 20,
}).use(tasklist, { disabled: true });

// Table column alignment arrives as an inline style, which the sanitizer
// removes; carry it as a class instead.
md.core.ruler.push('align_classes', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'th_open' && token.type !== 'td_open') continue;
    const align = /text-align:(left|center|right)/.exec(String(token.attrGet('style') ?? ''));
    if (!align) continue;
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    token.attrJoin('class', `md-align-${align[1]}`);
  }
});

// Images inside a link (a badge, say): marked in one pass over each inline
// run, so the renderer need not rescan the tokens before every image.
md.core.ruler.push('images_in_links', (state) => {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    let depth = 0;
    for (const token of block.children) {
      if (token.type === 'link_open') depth++;
      else if (token.type === 'link_close') depth--;
      else if (token.type === 'image' && depth > 0) token.meta = { ...token.meta, inLink: true };
    }
  }
});

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet('src') ?? '');
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const { escapeHtml } = md.utils;
  // Inside a link the outer link wins; anchors cannot nest.
  if (token.meta?.inLink) return `<span class="md-image">${escapeHtml(alt || src)}</span>`;
  return `<a class="md-image" href="${escapeHtml(src)}">${escapeHtml(alt || src)}</a>`;
};

export const markdownRenderer: PreviewRenderer = {
  render: (content) => md.render(content),
};
