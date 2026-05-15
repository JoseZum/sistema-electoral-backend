import { defineConfig, devices } from '@playwright/test';

const frontendBaseUrl =
  process.env.E2E_FRONTEND_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/setup/global-setup.ts',
  outputDir: 'test-results',
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: frontendBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
