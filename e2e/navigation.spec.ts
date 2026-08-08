import { test, expect } from "./fixtures";

/**
 * Ticket 0014 — skip-to-section slider E2E.
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` builds the extension, loads it into headed Chromium, and
 * serves fixture pages locally. The overlay mounts in an open Shadow DOM under
 * `[data-extension-root="true"]`; Playwright's CSS engine pierces open shadow
 * boundaries, so `.overlay_range--nav` resolves inside it.
 *
 * The fixture article (`e2e/fixtures/article.html`) yields 8 chunks with 4
 * heading markers: The Slow Web (0), Why read aloud (2), How it works (4),
 * Engines (6). The 2nd marker is "Why read aloud" at chunk 2 of 8 → 28.6%.
 */
test("dragging to the 2nd heading marker moves reading position to that heading's chunk", async ({
  page,
  serverUrl,
}) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });

  // Expand the accordion overlay to reveal the navigation section.
  await page.locator(".overlay_handle").click();

  const slider = page.locator(".overlay_range--nav");
  await expect(slider).toBeVisible();

  // Jump to the 2nd marker (value 1 of 0..3).
  await slider.fill("1");

  // The readout beside the slider shows the current heading and live percent.
  await expect(page.locator(".overlay_nav_heading")).toHaveText("Why read aloud");
  await expect(page.locator(".overlay_nav_readout")).toContainText("28.6%");
});
