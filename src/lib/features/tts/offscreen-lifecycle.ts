import { getChrome } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0005 — Chromium offscreen document lifecycle.
 *
 * The background service worker creates the offscreen document that hosts the
 * `<audio>` pipeline and keeps it alive. MV3 service workers can't render
 * audio, so WASM Piper (0006) will run inside this document.
 *
 * Chromium-only: `chrome.offscreen` exists only on Chrome/Edge. Firefox's
 * event-page background already has DOM access, and node tests have no
 * `chrome` global — in both, {@link ensureOffscreenDocument} is a no-op.
 *
 * Idempotent: if `chrome.offscreen.hasDocument` is available, it is checked
 * first; a creation race is swallowed so repeated calls (service worker wakes)
 * never throw.
 */

/** Path to the offscreen document, relative to the built extension root. */
export const OFFSCREEN_URL = "pages/offscreen.html";

/** Chrome `offscreen.Reason` for audio playback (string for portability). */
const AUDIO_PLAYBACK_REASON = "AUDIO_PLAYBACK";

const JUSTIFICATION = "Host the <audio> pipeline for WASM Piper TTS playback.";

/**
 * Ensures the offscreen document exists, creating it if needed. No-op when
 * `chrome.offscreen` is unavailable (Firefox / node). Never rejects — a
 * creation race ("already created") is treated as success.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  const offscreen = getChrome()?.offscreen;
  if (!offscreen) return;

  try {
    if (offscreen.hasDocument) {
      const exists = await offscreen.hasDocument();
      if (exists) return;
    }
    await offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [AUDIO_PLAYBACK_REASON],
      justification: JUSTIFICATION,
    });
  } catch {
    // Already exists (creation race across service-worker wakes) or
    // unavailable in this context — either way the document is present.
  }
}
