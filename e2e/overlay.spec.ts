import { test, expect } from "./fixtures";

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
 * Interaction goes through the `OverlayPage` POM (`e2e/pages/overlay-page.ts`)
 * injected via the `overlayPage` fixture.
 */
test("the overlay is hidden until the extension icon activates it", async ({ overlayPage }) => {
  await overlayPage.gotoArticle();

  // The content script appends a host element isolated from page styles.
  await expect(overlayPage.host()).toBeAttached();

  // Bug 1 gate: until the extension icon is clicked, the overlay renders
  // nothing — the Shadow DOM host exists but `.overlay_root` is absent.
  await expect(overlayPage.overlayRoot()).toHaveCount(0);

  // Activating (icon click → openwebtts:activate; E2E drives the same path
  // via the openwebtts:test:activate seam) renders the accordion shell.
  await overlayPage.activate();

  // The accordion overlay shell lives inside the host's open Shadow DOM;
  // Playwright's CSS engine pierces open shadow boundaries.
  const overlay = overlayPage.overlayRoot();
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("OpenWebTTS");
});
