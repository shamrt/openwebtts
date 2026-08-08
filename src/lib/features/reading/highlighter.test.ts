/**
 * Ticket 0016 — tests for the as-you-read highlighter.
 */

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createHighlighter,
  findSentenceIndex,
  toHighlightUnit,
  toSentenceHighlightUnit,
} from "./highlighter.js";

function fixture(html: string): Document {
  const doc = document.implementation.createHTMLDocument("fixture");
  doc.body.innerHTML = html;
  return doc;
}

describe("findSentenceIndex", () => {
  it("selects the sentence containing the char offset", () => {
    expect(findSentenceIndex("First sentence. Second sentence. Third!", 6)).toBe(0);
    expect(findSentenceIndex("First sentence. Second sentence. Third!", 20)).toBe(1);
    expect(findSentenceIndex("First sentence. Second sentence. Third!", 38)).toBe(2);
  });

  it("returns the last sentence when the offset is at the end", () => {
    expect(findSentenceIndex("One. Two.", 100)).toBe(1);
  });
});

describe("createHighlighter", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "document",
      fixture(`
      <article>
        <p id="p1">First paragraph. It has two sentences.</p>
        <p id="p2">Second paragraph. Also two sentences.</p>
      </article>
    `),
    );
  });

  it("paragraph mode adds the active class to the element", () => {
    const highlighter = createHighlighter("paragraph");
    highlighter.set(
      toHighlightUnit({ anchor: "#p1" } as ReturnType<typeof toHighlightUnit>["chunk"]),
    );
    expect(document.querySelector("#p1")?.classList.contains("openwebtts-active")).toBe(true);
    expect(document.querySelector("#p2")?.classList.contains("openwebtts-active")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("sentence mode wraps the active sentence", () => {
    const highlighter = createHighlighter("sentence");
    highlighter.set(
      toSentenceHighlightUnit(
        { anchor: "#p1", text: "First paragraph. It has two sentences." } as Parameters<
          typeof toSentenceHighlightUnit
        >[0],
        20,
      ),
    );
    const wrapper = document.querySelector("#p1 .openwebtts-active");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.textContent).toBe("It has two sentences.");
    vi.unstubAllGlobals();
  });

  it("off mode renders nothing", () => {
    const highlighter = createHighlighter("off");
    highlighter.set(
      toHighlightUnit({ anchor: "#p1" } as ReturnType<typeof toHighlightUnit>["chunk"]),
    );
    expect(document.querySelector(".openwebtts-active")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("clear removes the active class", () => {
    const highlighter = createHighlighter("paragraph");
    highlighter.set(
      toHighlightUnit({ anchor: "#p1" } as ReturnType<typeof toHighlightUnit>["chunk"]),
    );
    highlighter.clear();
    expect(document.querySelector(".openwebtts-active")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("setMode off clears existing highlights", () => {
    const highlighter = createHighlighter("paragraph");
    highlighter.set(
      toHighlightUnit({ anchor: "#p1" } as ReturnType<typeof toHighlightUnit>["chunk"]),
    );
    highlighter.setMode("off");
    expect(document.querySelector(".openwebtts-active")).toBeNull();
    vi.unstubAllGlobals();
  });
});
