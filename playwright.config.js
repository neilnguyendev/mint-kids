// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * The suite drives a real Chromium against the same static tree GitHub Pages
 * serves, started by serve.py. Everything here talks to live YouTube and a live
 * published Google Sheet on purpose: these tests exist to catch the day one of
 * those stops working without an API key, which is the assumption the whole
 * app rests on.
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 serve.py',
    url: 'http://localhost:8080/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
