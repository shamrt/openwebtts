// @vitest-environment node
/**
 * Ticket 0010 (lazy-loading) — proves pdf.js is NOT pulled in until the first
 * `extractPdf` call, and that repeated calls share one load.
 */

import { describe, expect, it, vi } from "vite-plus/test";

let loadCount = 0;

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  loadCount += 1;
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 0,
        getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }),
        getMetadata: () => Promise.resolve({}),
        cleanup: () => Promise.resolve(),
      }),
    }),
    GlobalWorkerOptions: { workerSrc: "" },
  };
});

describe("extractPdf lazy loading", () => {
  it("does not load pdf.js until extractPdf is called, then loads it once", async () => {
    // Dynamic import exercises the module-loading boundary: a static import
    // would evaluate the extractor before we can assert pdf.js is untouched.
    const { extractPdf } = await import("./pdf-extractor.js");

    // Importing the extractor module must NOT evaluate pdf.js.
    expect(loadCount).toBe(0);

    // First call lazy-loads pdf.js.
    await extractPdf(new Uint8Array(0));
    expect(loadCount).toBe(1);

    // Second call reuses the cached module — no second load.
    await extractPdf(new Uint8Array(0));
    expect(loadCount).toBe(1);
  });
});
