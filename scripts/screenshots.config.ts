import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// Regenerates the README screenshots in docs/media: pnpm screenshots
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'screenshots.shot.ts',
  timeout: 30_000,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 760 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
