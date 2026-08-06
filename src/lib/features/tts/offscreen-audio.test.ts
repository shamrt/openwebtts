import { startOffscreenAudio } from "$lib/features/tts/offscreen-audio";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0005 — offscreen document audio host.
 *
 * The host owns the `<audio>` element and translates runtime messages into
 * `HTMLAudioElement` calls. Node has no DOM; these tests install a fake
 * `document` (returning a fake `<audio>`) and a fake `chrome.runtime.onMessage`
 * bus, then drive the host directly to assert real playback behavior — not
 * just that mocks were called.
 */

interface FakeAudio {
  src: string;
  currentTime: number;
  playCalls: number;
  pauseCalls: number;
  play(): Promise<void>;
  pause(): void;
}

function createFakeAudio(): FakeAudio {
  return {
    src: "",
    currentTime: 0,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls += 1;
    },
  };
}

let audio: FakeAudio;
type Listener = (message: unknown) => unknown;
const listeners = new Set<Listener>();
let dispose: (() => void) | undefined;

interface SavedGlobals {
  chrome?: unknown;
  document?: unknown;
}
const saved: SavedGlobals = {};

function installGlobals(a: FakeAudio): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  saved.document = g.document;
  g.chrome = {
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: {
        addListener(cb: Listener) {
          listeners.add(cb);
        },
        removeListener(cb: Listener) {
          listeners.delete(cb);
        },
      },
    },
  };
  g.document = { createElement: (tag: string) => (tag === "audio" ? a : null) };
}

function restoreGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
  if ("document" in saved) g.document = saved.document;
  else delete g.document;
  listeners.clear();
}

function dispatch(message: unknown): void {
  for (const cb of listeners) cb(message);
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  restoreGlobals();
});

describe("offscreen audio host (ticket 0005)", () => {
  it("load sets the audio element src", () => {
    audio = createFakeAudio();
    installGlobals(audio);
    dispose = startOffscreenAudio();

    dispatch({ type: "tts:audio:internal:load", src: "blob:https://openwebtts/silent" });

    expect(audio.src).toBe("blob:https://openwebtts/silent");
  });

  it("play/pause/stop drive the audio element", async () => {
    audio = createFakeAudio();
    installGlobals(audio);
    dispose = startOffscreenAudio();

    dispatch({ type: "tts:audio:internal:play" });
    dispatch({ type: "tts:audio:internal:pause" });
    dispatch({ type: "tts:audio:internal:stop" });

    expect(audio.playCalls).toBe(1);
    expect(audio.pauseCalls).toBe(2);
    expect(audio.currentTime).toBe(0);
  });

  it("ignores the public controller messages (only internal commands drive the host)", () => {
    audio = createFakeAudio();
    installGlobals(audio);
    dispose = startOffscreenAudio();

    // The background router forwards internal commands; the host must NOT
    // act on a controller's direct public broadcast (would double-deliver).
    dispatch({ type: "tts:audio:play" });
    dispatch({ type: "tts:audio:load", src: "blob:x" });

    expect(audio.playCalls).toBe(0);
    expect(audio.src).toBe("");
  });

  it("ignores unrelated message types without touching the audio element", () => {
    audio = createFakeAudio();
    installGlobals(audio);
    dispose = startOffscreenAudio();

    dispatch({ type: "openSidebar" });
    dispatch({ type: "tts:audio:internal:unknown" });

    expect(audio.playCalls).toBe(0);
    expect(audio.pauseCalls).toBe(0);
    expect(audio.src).toBe("");
  });

  it("is a no-op when document or chrome.runtime is absent (node-safe)", () => {
    const g = globalThis as Record<string, unknown>;
    delete g.chrome;
    delete g.document;
    const disposeFn = startOffscreenAudio();
    expect(typeof disposeFn).toBe("function");
    expect(() => disposeFn()).not.toThrow();
  });

  it("disposer removes the runtime listener", () => {
    audio = createFakeAudio();
    installGlobals(audio);
    dispose = startOffscreenAudio();

    dispose();
    dispose = undefined;
    dispatch({ type: "tts:audio:internal:play" });

    expect(audio.playCalls).toBe(0);
  });
});
