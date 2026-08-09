import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";

/**
 * Ticket 0014 + 0022 — navigation E2E.
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e): the harness in
 * `e2e/fixtures.ts` builds the extension, loads it into headed Chromium, and
 * serves fixture pages locally. The overlay mounts in an open Shadow DOM under
 * `[data-extension-root="true"]`; Playwright's CSS engine pierces open shadow
 * boundaries, so `.overlay_range--nav` resolves inside it. Interaction goes
 * through the `OverlayPage` POM.
 *
 * The fixture article (`e2e/fixtures/article.html`) yields 8 chunks with 4
 * heading markers: The Slow Web (0), Why read aloud (2), How it works (4),
 * Engines (6). The 2nd marker is "Why read aloud" at chunk 2 of 8.
 */

/** Force the silent Piper path (no speechSynthesis voices) so the 0022 smart-back
 * test never depends on real audio or word-boundary events: the coordinator's
 * elapsed clock decides the threshold deterministically, and the page stays
 * silent during the suite. */
async function useSilentTts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const synth = window.speechSynthesis;
    if (synth) {
      // speechSynthesis is a WebIDL interface object; assigning an own
      // property shadows getVoices for every world, including the content
      // script's. Empty voices → the hybrid controller resolves to the silent
      // Piper path, so no audio and no boundary events.
      const stubbable = synth as unknown as { getVoices: () => unknown[] };
      stubbable.getVoices = () => [];
    }
  });
}

test("dragging to the 2nd heading marker moves reading position to that heading's chunk", async ({
  overlayPage,
}) => {
  await overlayPage.gotoArticle();

  // The overlay is hidden until activated (Slice C); activate before interacting.
  await overlayPage.activate();

  // Expand the accordion overlay to reveal the navigation section.
  await overlayPage.expand();
  await expect(overlayPage.navSlider()).toBeVisible();

  // The slider is a continuous char-weighted 0–100 progress bar (ticket 0022);
  // heading markers sit at each heading chunk's percent. Jump to the 2nd
  // marker ("Why read aloud") by filling the slider with the marker's value.
  await overlayPage.dragNavTo(1);

  // The readout beside the slider shows the current heading and the marker's
  // percent.
  await expect(overlayPage.navHeading()).toHaveText("Why read aloud");
  const markerValue = await overlayPage
    .navSlider()
    .evaluate((el) => (el as HTMLInputElement).value);
  await expect(overlayPage.navReadout()).toContainText(`${markerValue}%`);
});

test("prev/next chunk navigation and smart-back (ticket 0022)", async ({ page, overlayPage }) => {
  await useSilentTts(page);
  await overlayPage.gotoThreeChunks();
  await overlayPage.activate();
  await overlayPage.expand();

  const back = overlayPage.backButton();
  const forward = overlayPage.forwardButton();
  const progress = overlayPage.progress();
  // Scope to the fixture's <article> — the overlay's own .overlay_progress is
  // also a <p> whose text repeats the current chunk.
  const firstParagraph = page.locator("article p", {
    hasText: "The first paragraph belongs",
  });
  const lastParagraph = page.locator("article p", {
    hasText: "The second paragraph is the third",
  });

  // The 3-chunk fixture: [Part One, first paragraph, last paragraph]. The last
  // paragraph starts below the fold, so "scroll into view" is observable.
  await expect(back).toBeDisabled(); // first chunk, within the threshold
  await expect(forward).toBeEnabled();

  // Start playback so forward/back autoplay and the elapsed clock runs.
  await overlayPage.expandedPlayPause().click();
  await expect(overlayPage.expandedPlayPause()).toHaveText("Pause");

  // Forward → chunk 2: position moves AND the target chunk scrolls into view.
  await forward.click();
  await expect(progress).toContainText("The first paragraph belongs");
  await expect(firstParagraph).toBeInViewport({ ratio: 0.8 });

  // Back within the 2s threshold → chunk 1 (Part One); back disabled again.
  await back.click();
  await expect(progress).toContainText("Part One");
  await expect(back).toBeDisabled();
  await expect(forward).toBeEnabled();

  // Forward again, wait past the 2s threshold, then back: the current chunk
  // restarts from its top (position stays on chunk 2).
  await forward.click();
  await expect(progress).toContainText("The first paragraph belongs");
  await page.waitForTimeout(2600);
  await back.click();
  await expect(progress).toContainText("The first paragraph belongs");
  await expect(firstParagraph).toBeInViewport({ ratio: 0.8 });

  // Forward to the last chunk: forward becomes disabled, target scrolls in.
  await forward.click();
  await expect(progress).toContainText("The second paragraph is the third");
  await expect(lastParagraph).toBeInViewport({ ratio: 0.8 });
  await expect(forward).toBeDisabled();

  // Back within the 2s threshold from the last chunk → chunk 2 again.
  await back.click();
  await expect(progress).toContainText("The first paragraph belongs");
});
