import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3138";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: require.resolve("./tests/e2e/auth.setup"),
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }], ["junit", { outputFile: "test-results/e2e-junit.xml" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results",
  use: {
    baseURL: webBaseUrl,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
