/**
 * Overlay feature public API (barrel).
 *
 * The overlay is the content-script player UI: the store coordinates the
 * reading/tts/settings features, and the components under `components/` render
 * it. Cross-feature consumers (e.g. the content-script entrypoint) import
 * through this barrel.
 */

export {
  BACK_RESTART_THRESHOLD_SECONDS,
  createStore,
  type HeadingMarker,
  type NavState,
  type OverlayDependencies,
  type OverlayState,
  type OverlayStore,
} from "./store.js";
