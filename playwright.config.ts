import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build served by `vite preview` (`npm run build` first), or against
// a deployed site when E2E_BASE_URL is set. Two engines: Chromium desktop and WebKit on an iPhone 13 profile.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['dot']],
  use: { baseURL: external ?? 'http://127.0.0.1:4173', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'] } },
  ],
  ...(external ? {} : {
    webServer: { command: 'npx vite preview --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
      timeout: 60_000 },
  }),
});
