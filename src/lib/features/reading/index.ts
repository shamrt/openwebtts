/**
 * Reading feature public API (barrel).
 *
 * Cross-feature imports of reading internals must go through this barrel per
 * `eslint-plugin-boundaries` (see `vite.config.ts`).
 */

export type { HighlightUnit, Highlighter } from "./highlighter.js";
export {
  createHighlighter,
  findSentenceIndex,
  toHighlightUnit,
  toSentenceHighlightUnit,
} from "./highlighter.js";
export type {
  CreatePositionStoreOptions,
  PositionChangeListener,
  PositionStorage,
  PositionStore,
  ReadingPosition,
} from "./position.js";
export { createChromePositionStorage, createPositionStore } from "./position.js";
