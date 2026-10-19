import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3107);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  // First renders of each route after a cold start can exceed the 5 s default under parallel load.
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } }, grep: /@layout/ },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } }, grep: /@layout/ },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "small", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 640 } }, grep: /@layout/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // Wait on a page that builds the demo world, so the first tests do not race a cold start.
    url: `http://127.0.0.1:${PORT}/pulse`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DEMO_MODE: "true", CRON_SECRET: "e2e-cron-secret-0123456789" },
  },
});
