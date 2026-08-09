import { test, expect } from "./fixtures";

/**
 * Ticket 0013 — play/pause playback E2E.
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` builds the extension, loads it into headed Chromium, and
 * serves fixture pages locally. The collapsed overlay's play/pause button
 * lives in the content-script's open Shadow DOM; `[aria-label]` selectors
 * pierce open shadow boundaries, so they resolve inside the shadow root.
 * Interaction goes through the `OverlayPage` POM.
 */
test("the collapsed overlay play/pause button toggles playback state", async ({ overlayPage }) => {
  await overlayPage.gotoArticle();

  // The overlay is hidden until activated (Slice C); activate before interacting.
  await overlayPage.activate();

  // Collapsed (paused) → the button advertises the "play" action.
  await expect(overlayPage.playButton()).toBeVisible();

  // Start playback → the action flips to "pause".
  await overlayPage.playButton().click();
  await expect(overlayPage.pauseButton()).toBeVisible();

  // Pause again → the action flips back to "play".
  await overlayPage.pauseButton().click();
  await expect(overlayPage.playButton()).toBeVisible();
});
