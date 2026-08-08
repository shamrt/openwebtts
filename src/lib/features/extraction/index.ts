/**
 * Extraction feature public API (barrel).
 *
 * Cross-feature imports of extraction types must go through this barrel per
 * `eslint-plugin-boundaries` (see `.oxlintrc.json`).
 */

export type { ArticleChunk } from "./html-extractor.js";
