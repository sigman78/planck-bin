import { expect, type Page } from '@playwright/test';
import { S } from './selectors';

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Row label locator matching the label exactly (hint text excluded). */
export function paletteLabel(page: Page, label: string) {
  return page.locator(`${S.paletteRow} > span`, {
    hasText: new RegExp(`^${escapeRegex(label)}$`),
  });
}

export async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+/');
  await expect(page.locator(S.island)).toHaveClass(/open/);
  await expect(page.locator(S.paletteInput)).toBeFocused();
}

export async function closePalette(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator(S.island)).not.toHaveClass(/open/);
}

/** Open the palette, filter by the label, and run the top match. */
export async function runCommand(page: Page, label: string): Promise<void> {
  await openPalette(page);
  await page.locator(S.paletteInput).fill(label);
  await expect(page.locator(`${S.paletteSelected} > span`)).toHaveText(label);
  await page.keyboard.press('Enter');
}

/** Assert whether a command is offered in the current state. */
export async function expectCommand(page: Page, label: string, present: boolean): Promise<void> {
  await openPalette(page);
  await expect(paletteLabel(page, label)).toHaveCount(present ? 1 : 0);
  await closePalette(page);
}
