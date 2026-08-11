/**
 * Settings feature public API (barrel).
 *
 * Cross-feature imports of settings must go through this barrel per
 * `eslint-plugin-boundaries` (see `vite.config.ts`).
 */

export type {
  HighlightMode,
  ReaderSettings,
  SettingsChangeListener,
  SettingsStore,
  StorageArea,
} from "./settings.js";
export { chromeStorageArea, createSettingsStore, DEFAULT_SETTINGS } from "./settings.js";
