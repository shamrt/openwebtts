import { defineConfig } from "@playwright/test";

/**
 * Ticket 0020 — Playwright E2E config.
 *
 * The browser context + Extension.js dev server are wired in `e2e/fixtures.ts`
 * (the `context` fixture launches Chromium with the unpacked extension loaded).
 * See https://extension.js.org/docs/workflows/playwright-e2e.
 */
export default defineConfig({
  testDir: "./e2e",
  // The extension dev server and persistent context are shared across tests in
  // a worker; run serially with a single worker to keep the harness simple.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    // Unpacked extensions cannot load in headless Chromium; headed is required
    // (CI on Linux must run under `xvfb-run pnpm test:e2e`).
    headless: false,
    // Deliberately small viewport so fixture pages scroll: the navigation
    // specs assert that seeking scrolls the target chunk into view, which is
    // only observable when content overflows the viewport.
    viewport: { width: 900, height: 600 },
  },
});
