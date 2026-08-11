import { test, expect } from "./fixtures";

/**
 * The REAL activation path: the background service worker sends
 * { type: "openwebtts:activate" } to the active tab (what the toolbar-icon
 * click does), and the content script's runtime.onMessage listener must
 * render the overlay. The seam-based activate() in the POM bypasses this
 * path, so it is not covered by the other specs.
 */
// The service-worker runtime-message path is Chromium-only: Firefox runs the
// background as an event page, so `context.serviceWorkers()` is empty there.
// The overlay's render-on-activate behavior is covered cross-browser by the
// test-seam activation in overlay.spec.ts; this spec guards the real
// background->content message delivery on the platform that exposes it.
test.skip(
  process.env.OWT_E2E_BROWSER === "firefox",
  "service-worker runtime-message path is Chromium-only",
);
test("real runtime message activates the overlay", async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });

  // The overlay must be hidden before activation.
  await expect(page.locator('[data-extension-root="true"]').locator(".container")).toHaveCount(0);

  // Find the extension's service worker and send the same message the
  // background's action.onClicked handler sends on icon click.
  const workers = page.context().serviceWorkers();
  expect(workers.length).toBeGreaterThan(0);
  const worker = workers[0]!;

  const sent = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return false;
    await chrome.tabs.sendMessage(tab.id, { type: "openwebtts:activate" });
    return true;
  });
  expect(sent).toBe(true);

  await expect(page.locator('[data-extension-root="true"]').locator(".container")).toBeVisible();
});
