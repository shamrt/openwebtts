import { test, expect, activate } from "./fixtures";

/**
 * Ticket 0020 — Playwright E2E harness smoke test.
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` compiles the extension with `extension dev --no-browser`,
 * launches headed Chromium with the unpacked build loaded, and serves fixture
 * pages from a local server. The content-script overlay mounts in an open
 * Shadow DOM under `[data-extension-root="true"]`; Playwright's CSS engine
 * pierces open shadow boundaries, so `.overlay_root` resolves inside it.
 *
 * This is the harness every E2E-bearing ticket ([[0013]], [[0016]]) builds on.
 */
test("the accordion overlay appears on a fixture page", async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });

  // The content script appends a host element isolated from page styles.
  const host = page.locator('[data-extension-root="true"]');
  await expect(host).toBeAttached();

  // The overlay is hidden until the extension icon activates it (Slice C).
  await activate(page);

  // The accordion overlay shell lives inside the host's open Shadow DOM;
  // Playwright's CSS engine pierces open shadow boundaries.
  const overlay = page.locator(".overlay_root");
  await expect(overlay).toContainText("OpenWebTTS");
});
