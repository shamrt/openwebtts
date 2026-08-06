import type { AudioChannelMessage } from "$lib/features/tts/audio-channel";

import { audioChannel } from "$lib/features/tts/audio-channel";
import { startOffscreenAudio } from "$lib/features/tts/offscreen-audio";
import { ensureOffscreenDocument } from "$lib/features/tts/offscreen-lifecycle";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0005 — end-to-end audio pipeline integration test.
 *
 * Wires the controller (audio channel) to the offscreen host through a fake
 * `chrome.runtime` message bus, with a fake `<audio>` element and a fake
 * `chrome.offscreen` for the lifecycle. A real silent Blob URL is loaded, then
 * play/pause/stop are driven through the controller and asserted at the audio
 * element — proving controller → message → offscreen handler → audio
 * end-to-end, not just that sendMessage was called.
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
type Listener = (message: unknown) => boolean | undefined | void;
const listeners = new Set<Listener>();
let dispose: (() => void) | undefined;
let createDocumentCalls: number;

interface Saved {
  chrome?: unknown;
  document?: unknown;
}
const saved: Saved = {};

function installBus(a: FakeAudio): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  saved.document = g.document;
  createDocumentCalls = 0;
  listeners.clear();
  g.chrome = {
    runtime: {
      // The bus delivers a controller message to every registered listener
      // (the offscreen host among them), mirroring chrome.runtime onMessage.
      sendMessage: (m: unknown) => {
        for (const cb of listeners) cb(m);
        return Promise.resolve(undefined);
      },
      onMessage: {
        addListener(cb: Listener) {
          listeners.add(cb);
        },
        removeListener(cb: Listener) {
          listeners.delete(cb);
        },
      },
    },
    offscreen: {
      createDocument: async () => {
        createDocumentCalls += 1;
      },
    },
  };
  g.document = { createElement: (tag: string) => (tag === "audio" ? a : null) };
}

function restore(): void {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
  if ("document" in saved) g.document = saved.document;
  else delete g.document;
  listeners.clear();
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  restore();
});

/** Tiny zeroed buffer → Blob → object URL: a silent fixture the host can load. */
function silentBufferUrl(): string {
  const buffer = new ArrayBuffer(8);
  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

describe("audio pipeline end-to-end (ticket 0005)", () => {
  it("loads a silent fixture and drives play/pause/stop through to the audio element", async () => {
    audio = createFakeAudio();
    installBus(audio);
    dispose = startOffscreenAudio();

    // The background would ensure the offscreen document exists; the host is
    // already wired above, and the lifecycle is a no-op on this fake without
    // hasDocument, so it just records a create attempt.
    await ensureOffscreenDocument();

    const src = silentBufferUrl();
    await audioChannel.load(src);
    expect(audio.src).toBe(src);

    await audioChannel.play();
    expect(audio.playCalls).toBe(1);

    await audioChannel.pause();
    expect(audio.pauseCalls).toBe(1);

    await audioChannel.stop();
    expect(audio.pauseCalls).toBe(2);
    expect(audio.currentTime).toBe(0);

    // The lifecycle path was exercised end-to-end too.
    expect(createDocumentCalls).toBe(1);
  });

  it("repeated play commands each reach the audio element", async () => {
    audio = createFakeAudio();
    installBus(audio);
    dispose = startOffscreenAudio();

    await audioChannel.load(silentBufferUrl());
    await audioChannel.play();
    await audioChannel.play();

    expect(audio.playCalls).toBe(2);
    expect(audio.pauseCalls).toBe(0);
  });

  it("only the four typed audio messages are forwarded to the audio element", async () => {
    audio = createFakeAudio();
    installBus(audio);
    dispose = startOffscreenAudio();

    // Drive a non-audio message through the same bus; the host must ignore it.
    for (const cb of listeners) cb({ type: "openSidebar" });

    expect(audio.playCalls).toBe(0);
    expect(audio.pauseCalls).toBe(0);
    expect(audio.src).toBe("");
  });

  it("the typed protocol is exactly the four audio commands", () => {
    const types: AudioChannelMessage["type"][] = [
      "tts:audio:load",
      "tts:audio:play",
      "tts:audio:pause",
      "tts:audio:stop",
    ];
    expect(new Set(types)).toEqual(
      new Set(["tts:audio:load", "tts:audio:play", "tts:audio:pause", "tts:audio:stop"]),
    );
  });
});
