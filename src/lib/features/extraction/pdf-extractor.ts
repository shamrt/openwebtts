/**
 * Ticket 0010 — extract text from a PDF document into speakable chunks.
 *
 * Uses Mozilla `pdfjs-dist` (`getTextContent`) to read ordered text per page,
 * then segments each page into paragraph chunks split on blank lines. Each
 * chunk carries a synthetic `pdf:page=N` anchor (PDFs have no DOM to anchor
 * against) and no heading level.
 *
 * Output feeds [[0011-track-reading-position-and-progress]] and
 * [[0016-as-you-read-highlighting-configurable-granularity]].
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import type { ArticleChunk, ExtractedArticle } from "./html-extractor.js";

/**
 * Set the pdf.js worker source. Must be called once before `extractPdf`.
 * The worker is required by `getDocument`; in non-browser runtimes point this
 * at the legacy worker module via a `file://` URL.
 */
export function configurePdfWorker(workerSrc: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

/**
 * Build the plain text of a single page from `getTextContent` items.
 *
 * Items carry `str` fragments in reading order; an item with `hasEOL` ends
 * the current line. Consecutive EOLs produce blank lines, which the segmenter
 * splits on.
 */
function pageText(items: ReadonlyArray<{ str: string; hasEOL: boolean }>): string {
  let line = "";
  const lines: string[] = [];
  for (const item of items) {
    line += item.str;
    if (item.hasEOL) {
      lines.push(line);
      line = "";
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join("\n");
}

/**
 * Segment a page's text into paragraph chunks split on blank lines (two or
 * more consecutive newlines). A page with a single non-empty block and no
 * blank-line breaks stays one chunk. Empty/whitespace-only chunks are dropped.
 */
function segmentPage(text: string, pageNum: number, startIndex: number): ArticleChunk[] {
  const blocks = text.split(/\n{2,}/);
  const chunks: ArticleChunk[] = [];
  let index = startIndex;
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    chunks.push({
      index,
      text: trimmed,
      anchor: `pdf:page=${pageNum}`,
      headingLevel: null,
      headingText: null,
    });
    index += 1;
  }
  return chunks;
}

/**
 * Extract ordered text from a PDF document and segment it into speakable
 * chunks. Pages are processed 1..numPages in order; chunk indices are
 * sequential across all pages.
 */
export async function extractPdf(data: Uint8Array | ArrayBuffer): Promise<ExtractedArticle> {
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  let title = "PDF document";
  try {
    const meta = await doc.getMetadata();
    const metaTitle = (meta as { info?: { Title?: string } } | undefined)?.info?.Title;
    if (typeof metaTitle === "string" && metaTitle.length > 0) title = metaTitle;
  } catch {
    // Metadata is optional; fall back to the default title.
  }

  const chunks: ArticleChunk[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = pageText(content.items as ReadonlyArray<{ str: string; hasEOL: boolean }>);
    chunks.push(...segmentPage(text, pageNum, chunks.length));
  }

  await doc.cleanup();
  return { title, chunks };
}
