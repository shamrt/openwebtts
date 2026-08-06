/**
 * Ticket 0005 — narrow, node-safe typed surface over the `chrome.*` globals
 * used by the TTS audio pipeline.
 *
 * `@types/chrome` is not installed and the service worker references `chrome`
 * untyped. Importing these modules in node (vitest) must not crash, so every
 * access goes through {@link getChrome}, which returns `undefined` when the
 * `chrome` global is absent (node, and Firefox where the offscreen path is a
 * no-op). Each consumer guards its own usage.
 */

/** A `chrome.runtime.onMessage` listener (may return a promise in MV3). */
export type MessageListener = (message: unknown) => boolean | undefined | void | Promise<unknown>;

/** The `chrome.runtime` message-bus surface the pipeline uses. */
export interface ChromeRuntimeSurface {
  /** Sends a message to other extension contexts (offscreen document). */
  sendMessage(message: unknown): Promise<unknown>;
  /** Runtime message listener registration. */
  onMessage: {
    addListener(cb: MessageListener): void;
    removeListener(cb: MessageListener): void;
  };
}

/** The `chrome.offscreen` document lifecycle surface (Chromium only). */
export interface ChromeOffscreenSurface {
  createDocument(opts: { url: string; reasons: string[]; justification: string }): Promise<void>;
  /** `hasDocument` is available on Chrome 116+. Optional for older builds. */
  hasDocument?(): Promise<boolean>;
}

/** The slice of `chrome` the TTS pipeline touches. */
export interface ChromeSurface {
  runtime?: ChromeRuntimeSurface;
  offscreen?: ChromeOffscreenSurface;
}

/**
 * Returns the `chrome` global typed as the pipeline's narrow surface, or
 * `undefined` when it is absent (node test env, or a build without `chrome`).
 */
export function getChrome(): ChromeSurface | undefined {
  const g = globalThis as Record<string, unknown>;
  const c = g.chrome;
  return typeof c === "object" && c !== null ? (c as ChromeSurface) : undefined;
}
