import { test, expect } from "./fixtures";

/**
 * Ticket 0020 — first E2E.
 *
 * Loads the built extension into Chromium, navigates to a fixture page, and
 * asserts the content-script overlay (the "Open sidebar" pill mounted in an
 * open Shadow DOM) appears. This is the harness every E2E-bearing ticket
 * ([[0013]], [[0014]], [[0016]]) builds on.
 */
test("the content-script overlay appears on a fixture page", async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });

  // The content script appends a host element isolated from page styles.
  const host = page.locator('[data-extension-root="true"]');
  await expect(host).toBeAttached();

  // The pill lives inside the host's open Shadow DOM; Playwright's CSS engine
  // pierces open shadow boundaries, so `.content_pill` resolves within it.
  const pill = page.locator(".content_pill");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Open sidebar");
});
