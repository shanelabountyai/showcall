import { defineConfig, devices } from '@playwright/test';

/**
 * e2e runs against a production build, served on :4000 against .env.test —
 * the artifact that ships, not a dev server. `E2E_DEV=1` swaps in the dev
 * server for debugging one spec; the sweep always uses the build.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, // one seeded event shared by every spec, edited in place
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_DEV ? 'npm run dev:test' : 'npm run e2e:server',
    url: 'http://localhost:4000',
    timeout: 300_000, // a cold `next build` clears the usual 120s default
    reuseExistingServer: !process.env.CI,
  },
});
