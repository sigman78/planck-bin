/**
 * Pastes that open in preview unless the link says otherwise (#source). The
 * server marks their viewer so the source never paints before the preview.
 */
export const PREVIEW_BY_DEFAULT: ReadonlySet<string> = new Set(['about']);

/** Attribute on the server-rendered viewer of such a paste (see preview.css). */
export const PREVIEW_DEFAULT_ATTR = 'data-preview-default';
