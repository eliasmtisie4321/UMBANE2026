import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run the production build (vite build + vite preview) with the backend mocked
 * (e2e/support/backend.ts), so they need no Supabase project and give the same result every time.
 * The build goes to dist-e2e so it never mixes with the real dist/.
 */
const PORT = 4173
// 127.0.0.1 rather than localhost: on Windows, localhost can resolve to IPv6 first and make every
// request crawl.
const HOST = '127.0.0.1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Each test starts a browser; on a laptop more than two at once mostly adds waiting.
  workers: process.env.CI ? undefined : 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e.supabase.test',
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
    },
  },
  projects: [
    // Every journey on a desktop browser.
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Layout and accessibility on a tablet and a phone too.
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
      testMatch: /(layout|a11y)\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /(layout|a11y)\.spec\.ts/,
    },
  ],
})
