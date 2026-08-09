import { startAudioRouter } from "$lib/features/tts/audio-router";
import { ensureOffscreenDocument } from "$lib/features/tts/offscreen-lifecycle";

console.log("[From the background context] Hello from the background worker/script!");

// MV3 unifies the toolbar API as `action` on both Chromium and Firefox. The
// only per-browser difference is the extension global (`browser` on Firefox,
// `chrome` on Chromium; Chrome 148+ also exposes `browser`). The in-page
// overlay is the sole UI surface — clicking the toolbar icon just tells the
// active tab's content script to activate it. No side panel, no sidebar.
const api = (globalThis.browser ?? globalThis.chrome) as {
  action: {
    onClicked: { addListener(cb: (tab: { id?: number | null }) => void): void };
  };
  tabs: { sendMessage(id: number, message: unknown): Promise<unknown> };
};

api.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  // Diagnostic for the activation path: confirms the click fired and which
  // tab was targeted. The sendMessage rejection (no content script on the
  // tab, e.g. a restricted page) is logged instead of silently swallowed.
  console.log("[OpenWebTTS] toolbar clicked; activating tab", tab.id);
  void api.tabs
    .sendMessage(tab.id, { type: "openwebtts:activate" })
    .catch((e) => console.error("[OpenWebTTS] activate send failed", e));
});

// Ticket 0005 — Chromium-only offscreen document lifecycle. `chrome.offscreen`
// exists only on Chrome/Edge; ensureOffscreenDocument is a no-op where it (or
// the `chrome` global) is absent, so this is safe on Firefox and in node tests.
// Keeping the document alive: created once, it persists across service-worker
// wakes; each wake re-runs this idempotent ensure (hasDocument guard + race swallow).
void ensureOffscreenDocument();

// Ticket 0005 — route audio commands through the background so the offscreen
// document is (re)created before delivery. Chrome auto-closes an
// AUDIO_PLAYBACK document after ~30s of silence; the router re-ensures it on
// every command (idempotent + race-swallow), so a resume after a pause still
// reaches a live host. Chromium-only: no-op where `chrome.runtime` is absent.
startAudioRouter();
