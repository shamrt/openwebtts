import { test, expect } from "./fixtures";

/**
 * Ticket 0016 — highlighting E2E (all three modes).
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` builds the extension, loads it into headed Chromium, and
 * serves fixture pages locally. The highlighter marks the active unit with
 * the `openwebtts-active` class in the PAGE dom (not the shadow root), so
 * plain CSS selectors resolve it directly. Interaction goes through the
 * `OverlayPage` POM.
 *
 * Modes are driven deterministically through the DEV-gated test seam
 * (`openwebtts:test:set-mode` / `openwebtts:test:highlight` /
 * `openwebtts:test:clear`) so the suite never depends on real speechSynthesis.
 */
test("off mode highlights nothing", async ({ overlayPage }) => {
  await overlayPage.gotoArticle();
  await overlayPage.activate();

  await overlayPage.setHighlightMode("off");
  await overlayPage.driveHighlight(0, 0);

  await expect(overlayPage.activeHighlight()).toHaveCount(0);
});

test("paragraph mode highlights the whole chunk", async ({ overlayPage }) => {
  await overlayPage.gotoArticle();
  await overlayPage.activate();

  await overlayPage.setHighlightMode("paragraph");
  await overlayPage.driveHighlight(0, 0);

  // Exactly one paragraph element carries the active class.
  await expect(overlayPage.activeHighlight()).toHaveCount(1);

  // Clearing drops the highlight entirely.
  await overlayPage.clearHighlight();
  await expect(overlayPage.activeHighlight()).toHaveCount(0);
});

test("sentence mode advances across two sentences within one chunk", async ({ overlayPage }) => {
  await overlayPage.gotoSentences();
  await overlayPage.activate();

  // The first article paragraph holds two distinct sentences:
  //   0: "The first sentence is short."          (charOffset 0 lives here)
  //   1: "The second sentence is longer and clearly different." (charOffset 35 lives here)
  await overlayPage.setHighlightMode("sentence");
  await overlayPage.driveHighlight(0, 0);

  const active = overlayPage.activeHighlight();
  await expect(active).toHaveCount(1);
  // The active unit is a span wrapping the first sentence.
  await expect(active).toHaveJSProperty("tagName", "SPAN");
  await expect(active).toContainText("first sentence is short");

  const firstText = (await active.innerText()) ?? "";

  // Advance the charOffset into the second sentence of the same chunk.
  await overlayPage.driveHighlight(0, 35);
  await expect(active).toHaveCount(1);
  await expect(active).toContainText("second sentence is longer");

  const secondText = (await active.innerText()) ?? "";
  expect(secondText).not.toEqual(firstText);
});
