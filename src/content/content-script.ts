import type { HighlightMode } from "$lib/features/settings";
import type { MessageListener } from "$lib/shared/chrome-runtime";

import { createStore } from "$lib/features/overlay";
import PlayerContainer from "$lib/features/overlay/components/PlayerContainer.svelte";
import { getRuntime } from "$lib/shared/chrome-runtime";
// Extension.js content script entrypoint (TypeScript).
// - Mounts the Svelte overlay UI into an open Shadow DOM. Component styles are
//   scoped and injected into the shadow root by Svelte at mount time.
// - Hands the overlay store to the PlayerContainer, which bridges its event
//   API to runes ($state) and renders the presentational Player.
// - Exposes a CustomEvent test seam for E2E highlighting tests.
// Docs: https://extension.js.org/docs/content-scripts
import { mount } from "svelte";

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
  // Svelte injects each component's scoped styles into this shadow root.
  const shadowRoot = rootDiv.attachShadow({ mode: "open" });

  const overlayStore = createStore();

  // PlayerContainer owns the store→Svelte bridge: it mirrors the store's
  // observables into `$state` and delegates callbacks to its methods — no
  // writable-store mirroring or subscription wiring lives in the entrypoint.
  // Test seam: E2E tests dispatch CustomEvents on `document` to drive
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

  // Mount the Svelte overlay. PlayerContainer mirrors the store's observables
  // into runes state and renders the presentational Player — including the
  // async settings load and engine resolution. The mount result is unused.
  const _player = mount(PlayerContainer, {
    target: shadowRoot,
    props: { store: overlayStore },
  });

  return () => {
    for (const dispose of testDisposers) dispose();
    testDisposers.length = 0;
    if (runtimeListener && onMessage?.removeListener) onMessage.removeListener(runtimeListener);
    overlayStore.cleanup();
    rootDiv.remove();
  };
}
