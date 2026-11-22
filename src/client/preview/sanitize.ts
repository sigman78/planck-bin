/**
 * The one sanitizer for preview HTML (DOMPurify). Every preview mode's output
 * goes through sanitizeHtml before it reaches the page (see ./index.ts).
 *
 * On top of DOMPurify's HTML profile:
 * - no ids or names (nothing can shadow the page's own elements or globals),
 *   no inline styles, no forms or form controls apart from disabled
 *   checkboxes (task lists), no images (the CSP would block them anyway);
 * - links only to http(s) and mailto, opened in a new tab without referrer
 *   (paste URLs can be secrets) and marked as user content;
 * - only the class names the renderers emit.
 */

import DOMPurify, { type Config } from 'dompurify';

const ALLOWED_CLASS =
  /^(?:task-list-(?:container|item|item-label|item-checkbox)|contains-task-list|md-image|md-align-(?:left|center|right)|language-[\w-]+)$/;

const LINK_REL = 'noopener noreferrer nofollow ugc';

const SAFE_HREF = /^(?:https?|mailto):/i;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;

  const classes = node.getAttribute('class');
  if (classes !== null) {
    const kept = classes.split(/\s+/).filter((name) => ALLOWED_CLASS.test(name));
    if (kept.length > 0) node.setAttribute('class', kept.join(' '));
    else node.removeAttribute('class');
  }

  // Links: absolute http(s) and mailto only; relative and #fragment links are
  // dropped (they would resolve against the paste site, not the document).
  const href = node.getAttribute('href');
  if (href !== null && !SAFE_HREF.test(href.trim())) node.removeAttribute('href');
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('rel', LINK_REL);
    node.setAttribute('target', '_blank');
  }

  // Task list items: whatever arrives as an input leaves as a disabled checkbox.
  if (node.tagName === 'INPUT') {
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
  }
});

const CONFIG: Config & { RETURN_DOM_FRAGMENT: true } = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'img', 'iframe'],
  FORBID_ATTR: ['style', 'id', 'name'],
  SANITIZE_NAMED_PROPS: true,
  RETURN_DOM_FRAGMENT: true,
};

export function sanitizeHtml(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, CONFIG);
}
