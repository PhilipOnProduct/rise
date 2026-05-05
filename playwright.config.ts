import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Rise.
 *
 * Boots the Next.js dev server and runs a small set of end-to-end + visual
 * regression tests in Chromium. Keep the surface area small for now —
 * one onboarding spec at a time, expanded as features ship (PHI-36 / RISE-106).
 *
 * To run locally:
 *   npm run test:e2e
 * To update visual snapshots after an intentional UI change:
 *   npm run test:e2e -- --update-snapshots
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Forbid `.only` from sneaking into committed code
  forbidOnly: !!process.env.CI,
  // One retry on CI, none locally
  retries: process.env.CI ? 1 : 0,
  // Single worker locally for deterministic visual snapshots
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    // Dedicated port to avoid clashing with whatever the dev might already
    // be running on :3000 (Open WebUI, an unrelated `next dev`, etc.)
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Pin viewport so snapshots are deterministic
    viewport: { width: 1280, height: 800 },
  },

  // Pin Chromium only — visual snapshots can drift across browsers/OS
  // and we don't have CI matrix discipline yet.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Tighter snapshot tolerance is fine for our use case (text + simple layout).
  // If we add image-heavy screens, raise threshold per-test instead of globally.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  webServer: {
    // Boot Next.js dev on a Playwright-only port so the test never hits
    // whatever else might be on :3000.
    //
    // Override SITE_PASSWORD to empty so the middleware (see middleware.ts)
    // bypasses the auth gate for the test run. Tests don't need to know
    // the production password.
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SITE_PASSWORD: "",
    },
  },
});
