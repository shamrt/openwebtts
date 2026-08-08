import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";

/**
 * Ticket 0016 — highlighting E2E (all three modes).
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` builds the extension, loads it into headed Chromium, and
 * serves fixture pages locally. The highlighter marks the active unit with
 * the `openwebtts-active` class in the PAGE dom (not the shadow root), so
 * plain CSS selectors resolve it directly.
 *
 * Modes are driven deterministically through the DEV-gated test seam
 * (`openwebtts:test:set-mode` / `openwebtts:test:highlight` /
 * `openwebtts:test:clear`) so the suite never depends on real speechSynthesis.
 */

type HighlightMode = "off" | "paragraph" | "sentence";

/** Switch the store's highlight mode via the test seam. */
async function setMode(page: Page, mode: HighlightMode) {
  await page.evaluate(
    (m) =>
      document.dispatchEvent(new CustomEvent("openwebtts:test:set-mode", { detail: { mode: m } })),
    mode,
  );
}

/** Drive a boundary event via the test seam: position to chunkIndex, highlight at charOffset. */
async function highlight(page: Page, chunkIndex: number, charOffset: number) {
  await page.evaluate(
    ([i, off]) =>
      document.dispatchEvent(
        new CustomEvent("openwebtts:test:highlight", {
          detail: { chunkIndex: i, charOffset: off },
        }),
      ),
    [chunkIndex, charOffset],
  );
}

/** Clear the active highlight via the test seam. */
async function clearHighlight(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("openwebtts:test:clear")));
}

test("off mode highlights nothing", async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".overlay_root")).toBeVisible();

  await setMode(page, "off");
  await highlight(page, 0, 0);

  await expect(page.locator(".openwebtts-active")).toHaveCount(0);
});

test("paragraph mode highlights the whole chunk", async ({ page, serverUrl }) => {
  await page.goto(`${serverUrl}/article.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".overlay_root")).toBeVisible();

  await setMode(page, "paragraph");
  await highlight(page, 0, 0);

  // Exactly one paragraph element carries the active class.
  await expect(page.locator(".openwebtts-active")).toHaveCount(1);

  // Clearing drops the highlight entirely.
  await clearHighlight(page);
  await expect(page.locator(".openwebtts-active")).toHaveCount(0);
});

test("sentence mode advances across two sentences within one chunk", async ({
  page,
  serverUrl,
}) => {
  await page.goto(`${serverUrl}/sentences.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".overlay_root")).toBeVisible();

  // The first article paragraph holds two distinct sentences:
  //   0: "The first sentence is short."          (charOffset 0 lives here)
  //   1: "The second sentence is longer and clearly different." (charOffset 35 lives here)
  await setMode(page, "sentence");
  await highlight(page, 0, 0);

  const active = page.locator(".openwebtts-active");
  await expect(active).toHaveCount(1);
  // The active unit is a span wrapping the first sentence.
  await expect(active).toHaveJSProperty("tagName", "SPAN");
  await expect(active).toContainText("first sentence is short");

  const firstText = (await active.innerText()) ?? "";

  // Advance the charOffset into the second sentence of the same chunk.
  await highlight(page, 0, 35);
  await expect(active).toHaveCount(1);
  await expect(active).toContainText("second sentence is longer");

  const secondText = (await active.innerText()) ?? "";
  expect(secondText).not.toEqual(firstText);
});
