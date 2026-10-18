import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    // Optional: use an already-installed Chromium instead of the version Playwright expects.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "node e2e/mock-groq.mjs", port: 4010, reuseExistingServer: !process.env.CI },
    {
      command: "npm run build && npx next start -p 3100",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        SQLITE_PATH: "./data/e2e.db",
        GROQ_API_KEY: "e2e-key",
        GROQ_BASE_URL: "http://127.0.0.1:4010/openai/v1",
        QUERA_MAX_WAIT_MS: "30000",
      },
    },
  ],
});
