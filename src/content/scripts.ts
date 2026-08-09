import type { HighlightMode } from "$lib/features/settings";
import type { MessageListener } from "$lib/shared/chrome-runtime";

import { getRuntime } from "$lib/shared/chrome-runtime";
// Extension.js content script entrypoint (TypeScript).
// - Mounts the Svelte overlay UI into an open Shadow DOM.
// - Injects the overlay shell CSS (plain CSS, no Tailwind — the content-script
//   build does not run @tailwindcss/vite) at build time via a `?inline` import.
// - Bridges the plain-TS overlay store to Svelte reactivity via writable stores.
// - Exposes a DEV-gated CustomEvent test seam for E2E highlighting tests.
// Docs: https://extension.js.org/docs/content-scripts
import { mount } from "svelte";
import { writable } from "svelte/store";

import { createOverlayStore } from "./overlay-store.js";
import OverlayApp from "./OverlayApp.svelte";
import overlayCss from "./styles.css?inline";

console.log("[OpenWebTTS] content script ready");

/**
 * Extension.js content_script entrypoint. The framework calls this on
 * injection and calls the returned function on HMR/teardown to clean up.
 * Do not invoke it yourself.
 */
export default function initial() {
  const rootDiv = document.createElement("div");
  rootDiv.setAttribute("data-extension-root", "true");
  // Isolate the host from page styles (e.g. example.com ships div{opacity:.8},
  // which would otherwise fade the whole widget): the shadow DOM only protects
  // descendants; the host element itself still takes page CSS.
  rootDiv.style.cssText = "all: initial !important";
  document.body.appendChild(rootDiv);

  // Mounting inside a shadow DOM prevents the extension's styles from leaking
  // into the host page and vice-versa. The shadow root is OPEN so Playwright
  // CSS selectors and the test seam (CustomEvents on `document`) can reach in.
  const shadowRoot = rootDiv.attachShadow({ mode: "open" });

  const styleElement = document.createElement("style");
  styleElement.textContent = overlayCss;
  shadowRoot.appendChild(styleElement);
  const contentDiv = document.createElement("div");
  contentDiv.className = "content_script";
  shadowRoot.appendChild(contentDiv);

  const overlayStore = createOverlayStore();

  // Bridge the plain-TS overlay store to Svelte reactivity. The store is a
  // plain module (Svelte runes can't live in a .ts compiled by svelte-loader),
  // so its observable state is mirrored into writable stores and passed to the
  // overlay, which reads them with `$` and re-renders on change.
  const ui = {
    expanded: writable(overlayStore.expanded),
    activated: writable(overlayStore.activated),
    playing: writable(overlayStore.state.status === "playing"),
    positionPercent: writable(overlayStore.positionPercent),
    chunkText: writable(overlayStore.currentChunk?.text ?? ""),
    currentHeadingIndex: writable(overlayStore.currentHeadingIndex),
    canBack: writable(overlayStore.nav.canBack),
    canForward: writable(overlayStore.nav.canForward),
    engineKind: writable(overlayStore.engineKind),
    highlightMode: writable(overlayStore.settings.highlightMode),
    rate: writable([overlayStore.settings.rate]),
    volume: writable([overlayStore.settings.volume]),
    pitch: writable([overlayStore.settings.pitch]),
    voiceUri: writable(overlayStore.settings.voiceUri),
    voices: writable(overlayStore.voices),
  };
  const reactiveDisposers = [
    overlayStore.onStateChange((s) => ui.playing.set(s.status === "playing")),
    overlayStore.onExpandedChange((e) => ui.expanded.set(e)),
    overlayStore.onActivatedChange((a) => ui.activated.set(a)),
    overlayStore.onChunkChange(() => {
      ui.chunkText.set(overlayStore.currentChunk?.text ?? "");
      ui.positionPercent.set(overlayStore.positionPercent);
      ui.currentHeadingIndex.set(overlayStore.currentHeadingIndex);
    }),
    overlayStore.onEngineChange((k) => ui.engineKind.set(k)),
    overlayStore.onSettingsChange((s) => {
      ui.highlightMode.set(s.highlightMode);
      ui.rate.set([s.rate]);
      ui.volume.set([s.volume]);
      ui.pitch.set([s.pitch]);
      ui.voiceUri.set(s.voiceUri);
    }),
    overlayStore.onVoicesChange((v) => ui.voices.set(v)),
    overlayStore.onNavChange((nav) => {
      ui.canBack.set(nav.canBack);
      ui.canForward.set(nav.canForward);
    }),
  ];
  // DEV-only test seam: E2E tests dispatch CustomEvents on `document` to drive
  // highlight modes and boundary-style highlighting deterministically, without
  // relying on real speechSynthesis. Listeners cross the isolated-world
  // boundary via CustomEvent.detail (a plain object).
  const testDisposers: Array<() => void> = [];
  // The test seam is always registered. Extension.js's content-script build
  // (svelte-loader/webpack) does not define `import.meta.env.DEV`, so a DEV
  // gate would never open and E2E could not drive highlighting deterministically.
  // The seam only drives visual highlighting / clears it via scoped CustomEvent
  // names; the worst a host page can do is briefly highlight its own text or
  // flip the (local) highlight-mode setting — no data leaves the extension.
  const onSetMode = (e: Event) => {
    const { mode } = (e as CustomEvent<{ mode: HighlightMode }>).detail ?? {};
    if (mode === undefined) return;
    // Synchronous so a following `test:highlight` in the same tick sees the new
    // mode (the real setHighlightMode path persists via the settings store async).
    overlayStore.testSetHighlightMode(mode);
  };
  const onHighlight = (e: Event) => {
    const detail = (e as CustomEvent<{ chunkIndex: number; charOffset: number }>).detail;
    if (detail === undefined || detail.chunkIndex === undefined) return;
    overlayStore.testDriveHighlight(detail.chunkIndex, detail.charOffset ?? 0);
  };
  const onClear = () => overlayStore.testClearHighlight();
  const onActivate = () => overlayStore.activate();

  document.addEventListener("openwebtts:test:set-mode", onSetMode);
  document.addEventListener("openwebtts:test:highlight", onHighlight);
  document.addEventListener("openwebtts:test:clear", onClear);
  document.addEventListener("openwebtts:test:activate", onActivate);
  testDisposers.push(
    () => document.removeEventListener("openwebtts:test:set-mode", onSetMode),
    () => document.removeEventListener("openwebtts:test:highlight", onHighlight),
    () => document.removeEventListener("openwebtts:test:clear", onClear),
    () => document.removeEventListener("openwebtts:test:activate", onActivate),
  );

  // Real activation: the toolbar click (background `action.onClicked`) sends
  // "openwebtts:activate", which activates this tab's overlay. Resolved via
  // getRuntime() (browser ?? chrome) so the listener attaches on both Firefox
  // and Chromium; undefined in node (vitest) so the import is clean.
  const onMessage = getRuntime()?.onMessage;
  let runtimeListener: MessageListener | null = null;
  if (onMessage?.addListener) {
    runtimeListener = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "openwebtts:activate"
      ) {
        overlayStore.activate();
      }
    };
    onMessage.addListener(runtimeListener);
  }

  // Mount the Svelte overlay. Reactive state (expanded/playing/position/
  // chunkText/settings/voices) is passed as Svelte writable stores so the
  // overlay re-renders on store changes — including the async settings load
  // and engine resolution. The mount result is unused.
  const _app = mount(OverlayApp, {
    target: contentDiv,
    props: {
      expanded: ui.expanded,
      activated: ui.activated,
      playing: ui.playing,
      engineKind: ui.engineKind,
      highlightMode: ui.highlightMode,
      rate: ui.rate,
      volume: ui.volume,
      pitch: ui.pitch,
      voices: ui.voices,
      voiceUri: ui.voiceUri,
      positionPercent: ui.positionPercent,
      chunkText: ui.chunkText,
      headings: overlayStore.headings,
      currentHeadingIndex: ui.currentHeadingIndex,
      canBack: ui.canBack,
      canForward: ui.canForward,
      onToggleExpanded() {
        overlayStore.toggleExpanded();
      },
      onSeekPercent(percent) {
        overlayStore.seekToPercent(percent);
      },
      onBack() {
        overlayStore.backChunk();
      },
      onForward() {
        overlayStore.nextChunk();
      },
      onPlayPause() {
        if (overlayStore.state.status === "playing") {
          overlayStore.pause();
        } else {
          overlayStore.play();
        }
      },
      onStop() {
        overlayStore.stop();
      },
      onEngineChange(kind) {
        void overlayStore.setEngine(kind);
      },
      onHighlightModeChange(mode) {
        overlayStore.setHighlightMode(mode);
      },
      onRateChange(rate) {
        void overlayStore.setRate(rate);
      },
      onVolumeChange(volume) {
        void overlayStore.setVolume(volume);
      },
      onPitchChange(pitch) {
        void overlayStore.setPitch(pitch);
      },
      onVoiceChange(voiceUri) {
        void overlayStore.setVoice(voiceUri);
      },
      onClose() {
        overlayStore.close();
      },
    },
  });

  return () => {
    for (const dispose of testDisposers) dispose();
    for (const dispose of reactiveDisposers) dispose();
    testDisposers.length = 0;
    if (runtimeListener && onMessage?.removeListener) onMessage.removeListener(runtimeListener);
    overlayStore.cleanup();
    rootDiv.remove();
  };
}
