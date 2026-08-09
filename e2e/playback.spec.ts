import { test, expect, activate } from "./fixtures";

/**
 * Ticket 0013 — play/pause playback E2E.
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` builds the extension, loads it into headed Chromium, and
 * serves fixture pages locally. The collapsed overlay's play/pause button
 * lives in the content-script's open Shadow DOM; `[aria-label]` selectors
 * pierce open shadow boundaries, so they resolve inside the shadow root.
 */
test("the collapsed overlay play/pause button toggles playback state", async ({
  page,
  serverUrl,
}) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });

  // The overlay is hidden until activated (Slice C); activate before interacting.
  await activate(page);

  // Collapsed (paused) → the button advertises the "play" action.
  const play = page.locator('[aria-label="Play"]');
  await expect(play).toBeVisible();

  // Start playback → the action flips to "pause".
  await play.click();
  const pause = page.locator('[aria-label="Pause"]');
  await expect(pause).toBeVisible();

  // Pause again → the action flips back to "play".
  await pause.click();
  await expect(page.locator('[aria-label="Play"]')).toBeVisible();
});
