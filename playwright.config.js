// The browser tests. They need Playwright, a dev-only package, and a database
// server named in TEST_MYSQL_* or TEST_PGSQL_* (see tests/e2e/setup.php):
//
//     npm install
//     npx playwright install chromium
//     npx playwright test
//
// The app itself never loads anything from node_modules.
const { defineConfig } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');

const tmp = os.tmpdir();

module.exports = defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.js',
  // The specs share one database, so they run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'list' : 'line',
  globalSetup: './tests/e2e/global-setup.js',
  globalTeardown: './tests/e2e/global-teardown.js',
  use: {
    baseURL: 'http://127.0.0.1:8766',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'php -q -S 127.0.0.1:8766 router.php',
    url: 'http://127.0.0.1:8766/',
    reuseExistingServer: false,
    env: {
      ...process.env,
      // Read on every request, so it is there by the time the specs sign in.
      SQLARIS_CONFIG: path.join(tmp, 'sqlaris-e2e-config.php'),
      // Kept out of the project folder, so the user's own layout.json is never touched.
      SQLARIS_LAYOUT: path.join(tmp, 'sqlaris-e2e-layout.json'),
      SQLARIS_VIEWS: path.join(tmp, 'sqlaris-e2e-views.json'),
    },
  },
});
