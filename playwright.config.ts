import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:19140',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CODES_CHROME },
  },
  webServer: {
    command: 'node --import tsx scripts/test-server.ts',
    url: 'http://127.0.0.1:19140',
    reuseExistingServer: false,
    timeout: 20_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
