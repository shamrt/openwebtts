// @vitest-environment node
/**
 * Ticket 0010 — tests for the PDF text extractor.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it, beforeAll } from "vite-plus/test";

import { configurePdfWorker, extractPdf } from "./pdf-extractor.js";

beforeAll(() => {
  configurePdfWorker(
    pathToFileURL(
      new URL("../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url)
        .pathname,
    ).href,
  );
});

describe("extractPdf", () => {
  // pdf.js transfers the underlying buffer to the worker, detaching it, so
  // each test reads the fixture fresh.
  const fixturePath = new URL("./__fixtures__/sample.pdf", import.meta.url);

  it("extracts ordered text from a multi-page PDF", async () => {
    const article = await extractPdf(new Uint8Array(readFileSync(fixturePath)));

    // AC: title is a string (fixture has no Title metadata → "PDF document").
    expect(typeof article.title).toBe("string");

    // AC: segments into speakable chunks; fixture is 2 pages → 2 chunks.
    expect(article.chunks.length).toBeGreaterThanOrEqual(2);

    // AC: text ordering — chapter one before chapter two.
    const one = article.chunks.find((c) => c.text.includes("Chapter one"));
    const two = article.chunks.find((c) => c.text.includes("Chapter two"));
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one!.index).toBeLessThan(two!.index);
    expect(one!.text).toContain("Chapter one begins the story.");
    expect(two!.text).toContain("Chapter two continues it onward.");

    // AC: synthetic page anchors.
    expect(one!.anchor).toBe("pdf:page=1");
    expect(two!.anchor).toBe("pdf:page=2");

    // AC: PDF chunks carry no heading level.
    for (const chunk of article.chunks) {
      expect(chunk.headingLevel).toBeNull();
      expect(chunk.headingText).toBeNull();
    }
  });

  it("indexes chunks sequentially across pages", async () => {
    const article = await extractPdf(new Uint8Array(readFileSync(fixturePath)));
    expect(article.chunks.map((c) => c.index)).toEqual(article.chunks.map((_, i) => i));
  });
});
