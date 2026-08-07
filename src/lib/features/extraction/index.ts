/**
 * Extraction feature barrel.
 *
 * Extractors turn a source document (HTML article, reader-mode page, PDF) into
 * the shared {@link ArticleChunk} list the overlay reads.
 */

export type { ArticleChunk, ExtractedArticle } from "./html-extractor.js";
export { buildAnchor, extractArticle, segmentElement } from "./html-extractor.js";
