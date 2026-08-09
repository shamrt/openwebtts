import { type Locator, type Page } from "@playwright/test";

import type { HighlightMode } from "../../src/lib/features/settings";

/**
 * Ticket 0020 — Page Object Model for the OpenWebTTS content-script overlay.
 *
 * The overlay mounts in an open Shadow DOM under
 * `[data-extension-root="true"]`; Playwright's CSS engine pierces open shadow
 * boundaries, so the selectors below resolve inside it. Activation, fixture
 * navigation, and the DEV test seams (highlighting) are wrapped here so the
 * specs stay declarative and DRY.
 */

export class OverlayPage {
  constructor(
    private readonly page: Page,
    private readonly serverUrl: string,
  ) {}

  /** The content-script host element, isolated from page styles. */
  host(): Locator {
    return this.page.locator('[data-extension-root="true"]');
  }

  /** The accordion overlay shell, inside the host's open Shadow DOM. */
  overlayRoot(): Locator {
    return this.page.locator(".overlay_root");
  }

  async gotoArticle(): Promise<void> {
    await this.page.goto(`${this.serverUrl}/article.html`, {
      waitUntil: "domcontentloaded",
    });
  }

  async gotoSentences(): Promise<void> {
    await this.page.goto(`${this.serverUrl}/sentences.html`, {
      waitUntil: "domcontentloaded",
    });
  }

  /** The 3-chunk fixture used by the ticket 0022 navigation spec. */
  async gotoThreeChunks(): Promise<void> {
    await this.page.goto(`${this.serverUrl}/three-chunks.html`, {
      waitUntil: "domcontentloaded",
    });
  }

  /**
   * Activate the overlay. The overlay stays hidden until the extension icon is
   * clicked; E2E drives the same path via the openwebtts:test:activate seam
   * (dispatched on `document`), then waits for the rendered overlay root.
   *
   * The host element must be attached first: the content script registers the
   * seam listener before mounting the Svelte overlay, so dispatching the
   * activate event before the host is attached races listener registration and
   * the event is lost (the overlay never renders). Awaiting the host closes
   * that cold-mount race.
   */
  async activate(): Promise<void> {
    await this.host().waitFor({ state: "attached" });
    await this.page.evaluate(() =>
      document.dispatchEvent(new CustomEvent("openwebtts:test:activate")),
    );
    await this.overlayRoot().waitFor({ state: "visible" });
  }

  playButton(): Locator {
    return this.page.locator('[aria-label="Play"]');
  }

  pauseButton(): Locator {
    return this.page.locator('[aria-label="Pause"]');
  }

  /** The expanded panel's play/pause control (text-labeled). */
  expandedPlayPause(): Locator {
    return this.page.locator(".overlay_expanded").getByRole("button", { name: /Play|Pause/ });
  }

  /** The expanded panel's prev/next chunk buttons (ticket 0022). */
  backButton(): Locator {
    return this.page.locator(".overlay_expanded").getByRole("button", { name: "Previous chunk" });
  }

  forwardButton(): Locator {
    return this.page.locator(".overlay_expanded").getByRole("button", { name: "Next chunk" });
  }

  /** The expanded panel's live progress line: "{percent}% — {chunk text}". */
  progress(): Locator {
    return this.page.locator(".overlay_progress");
  }

  /**
   * Expand the collapsed overlay to reveal the navigation section. The handle
   * is a genuine toggle (role=button, onclick), but its width shifts as the
   * `$positionPercent` / `$chunkText` spans hydrate after activation; on a
   * cold render that keeps resetting Playwright's click-stability check (no
   * movement for 500ms) until the test times out. Waiting for visible, then
   * force-clicking, skips that over-strict heuristic while still dispatching a
   * real pointer click at the handle's current box.
   */
  async expand(): Promise<void> {
    const handle = this.page.locator(".overlay_handle");
    await handle.waitFor({ state: "visible" });
    await handle.click({ force: true });
  }

  navSlider(): Locator {
    return this.page.locator(".overlay_range--nav");
  }

  /**
   * Jump the slider to the 0-based heading marker. The slider is a continuous
   * char-weighted 0–100 progress bar (ticket 0022); each marker sits at its
   * heading chunk's percent, so the marker's own value is the fill target.
   */
  async dragNavTo(markerIndex: number): Promise<void> {
    const marker = this.page.locator("#openwebtts-heading-markers option").nth(markerIndex);
    const value = (await marker.getAttribute("value")) ?? "";
    await this.navSlider().fill(value);
  }

  navHeading(): Locator {
    return this.page.locator(".overlay_nav_heading");
  }

  navReadout(): Locator {
    return this.page.locator(".overlay_nav_readout");
  }

  /** Switch the store's highlight mode via the test seam. */
  async setHighlightMode(mode: HighlightMode): Promise<void> {
    await this.page.evaluate(
      (m) =>
        document.dispatchEvent(
          new CustomEvent("openwebtts:test:set-mode", { detail: { mode: m } }),
        ),
      mode,
    );
  }

  /** Drive a boundary event via the test seam: position to chunkIndex, highlight at charOffset. */
  async driveHighlight(chunkIndex: number, charOffset: number): Promise<void> {
    await this.page.evaluate(
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
  async clearHighlight(): Promise<void> {
    await this.page.evaluate(() =>
      document.dispatchEvent(new CustomEvent("openwebtts:test:clear")),
    );
  }

  /** The element currently carrying the active-highlight class (in the page DOM). */
  activeHighlight(): Locator {
    return this.page.locator(".openwebtts-active");
  }
}
