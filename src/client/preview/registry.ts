/**
 * The preview modes, cheap metadata only: each renderer is a dynamic import.
 * The first mode that matches a paste is offered for it.
 */

import type { PreviewMode } from './types';

export const MODES: readonly PreviewMode[] = [
  {
    id: 'markdown',
    label: 'Preview markdown',
    // The markdown mark: an M and a down arrow (the chip is its frame).
    icon: {
      width: 15,
      height: 10,
      paths: ['M1.5 8.5 V1.5 L4.25 5 L7 1.5 V8.5', 'M11 1.5 V8.5', 'M8.6 6.1 L11 8.5 L13.4 6.1'],
    },
    matches: (language) => language === 'markdown',
    load: () => import('./markdown').then((m) => m.markdownRenderer),
  },
];

export function findPreviewMode(language: string | undefined, content: string): PreviewMode | null {
  return MODES.find((mode) => mode.matches(language, content)) ?? null;
}
