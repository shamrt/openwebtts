import { startAudioRouter } from "$lib/features/tts/audio-router";
import { ensureOffscreenDocument } from "$lib/features/tts/offscreen-lifecycle";

console.log("[From the background context] Hello from the background worker/script!");

const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === "firefox" ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === "gecko-based";

if (isFirefoxLike) {
  browser.browserAction.onClicked.addListener(() => {
    browser.sidebarAction.open();
  });

  browser.runtime.onMessage.addListener((message: any) => {
    if (!message || message.type !== "openSidebar") return;

    browser.sidebarAction.open();
  });
}

if (!isFirefoxLike) {
  // setPanelBehavior only affects FUTURE action clicks — registering it
  // inside onClicked would swallow the first toolbar click.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "openSidebar") return;

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  if (!chrome.sidePanel.open) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTabId = tabs && tabs[0] && tabs[0].id;
    if (!activeTabId) return;

    try {
      chrome.sidePanel.open({ tabId: activeTabId });
    } catch (error) {
      console.error(error);
    }
  });
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
