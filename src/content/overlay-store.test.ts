/**
 * Ticket 0014 — tests for the overlay store's skip-to-section surface.
 *
 * The slider's data (heading markers), its seek behavior, and the current
 * heading readout all live behind the overlay store seam; the E2E spec
 * (`e2e/navigation.spec.ts`) covers the rendered slider itself.
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { createOverlayStore } from "./overlay-store.js";

function fixture(html: string): Document {
  const doc = document.implementation.createHTMLDocument("Fixture");
  doc.body.innerHTML = html;
  return doc;
}

// Readability folds an h1 matching the <title> into the article title; an
// h1 that differs stays in the content (normalized to h2). The fixture below
// therefore yields heading chunks at 0, 2, 4.
const ARTICLE = `
  <article>
    <h1>Intro</h1>
    <p>Para one.</p>
    <h2>Section A</h2>
    <p>Para two.</p>
    <h2>Section B</h2>
    <p>Para three.</p>
  </article>
`;

describe("createOverlayStore skip-to-section", () => {
  it("exposes heading markers from the extractor's heading metadata", () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();
    expect(store.headings).toEqual([
      { chunkIndex: 0, text: "Intro" },
      { chunkIndex: 2, text: "Section A" },
      { chunkIndex: 4, text: "Section B" },
    ]);
    vi.unstubAllGlobals();
  });

  it("seek moves the reading position to the heading's chunk", () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();
    store.seek(store.headings[1]!.chunkIndex);
    expect(store.currentHeadingIndex).toBe(1);
    expect(store.currentChunk?.headingText).toBe("Section A");
    // Chunk 2 of 6 → 2/5 = 40%.
    expect(store.positionPercent).toBe(40);
    vi.unstubAllGlobals();
  });

  it("reports the current heading for the active section", () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();
    expect(store.currentHeadingIndex).toBe(0); // Intro
    store.seek(3); // paragraph inside Section A (2nd heading)
    expect(store.currentHeadingIndex).toBe(1);
    store.seek(5); // paragraph inside Section B (3rd heading)
    expect(store.currentHeadingIndex).toBe(2);
    vi.unstubAllGlobals();
  });

  it("has no markers and a null heading when the article has no headings", () => {
    vi.stubGlobal(
      "document",
      fixture("<article><p>Only paragraphs.</p><p>More text.</p></article>"),
    );
    const store = createOverlayStore();
    expect(store.headings).toEqual([]);
    expect(store.currentHeadingIndex).toBeNull();
    vi.unstubAllGlobals();
  });
});
