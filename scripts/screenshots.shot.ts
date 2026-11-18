import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { setupMockApi } from '../e2e/helpers/mock-api';
import { S } from '../e2e/helpers/selectors';
import { syntaxTexts } from '../e2e/helpers/syntax';

const OUT = 'docs/media';
const SAMPLE = readFileSync('src/worker/config.ts', 'utf8');

test.beforeEach(async ({ page }) => {
  const store = await setupMockApi(page);
  store.set('worker-config', SAMPLE);
  // Skip first-visit hints so they do not cover the content
  await page.addInitScript(() => localStorage.setItem('haste-hint-stage', 'known'));
  await page.goto('/worker-config.ts');
  await expect(page.locator(S.viewer)).toContainText('export');
  await expect.poll(() => syntaxTexts(page, 'keyword')).toContain('export');
  // Wait out the page fade-in so the capture is not dimmed
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running')
  );
  await page.waitForTimeout(300);
});

test('viewer', async ({ page }) => {
  await page.screenshot({ path: `${OUT}/screenshot-viewer.png` });
});
