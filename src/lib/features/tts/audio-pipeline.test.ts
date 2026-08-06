import type { AudioChannelMessage } from "$lib/features/tts/audio-channel";

import { audioChannel } from "$lib/features/tts/audio-channel";
import { startAudioRouter } from "$lib/features/tts/audio-router";
import { startOffscreenAudio } from "$lib/features/tts/offscreen-audio";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0005 — end-to-end audio pipeline integration test.
 *
 * Wires controller → background router → offscreen host → `<audio>` through a
 * fake `chrome.runtime` message bus, with a fake `chrome.offscreen` that
 * models the document lifecycle (hasDocument / createDocument re-creating the
 * host listener). A real silent Blob URL is loaded, then play/pause/stop are
 * driven through the controller and asserted at the audio element.
 *
 * The background routes every audio command: it ensures the offscreen document
 * exists, then forwards an internal command the host accepts — so a command
 * arriving AFTER Chrome auto-closes the document (the pause-then-resume path)
 * still reaches a live host. The host ignores the controller's public
 * broadcast, so there is no double delivery.
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
let hostDispose: (() => void) | undefined;
let routerDispose: (() => void) | undefined;
let docAlive = false;
let createDocumentCalls: number;

interface Saved {
  chrome?: unknown;
  document?: unknown;
}
const saved: Saved = {};

/** (Re)create the offscreen document: re-registers the host listener. */
function startHost(): void {
  hostDispose?.();
  hostDispose = startOffscreenAudio();
}

/** Simulate Chrome's ~30s auto-close of the AUDIO_PLAYBACK document. */
function closeDoc(): void {
  hostDispose?.();
  hostDispose = undefined;
  docAlive = false;
}

function installBus(a: FakeAudio): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  saved.document = g.document;
  listeners.clear();
  createDocumentCalls = 0;
  docAlive = false;
  g.chrome = {
    runtime: {
      // The bus delivers a message to every registered listener (router +
      // host), mirroring chrome.runtime onMessage. A listener may return a
      // promise (the router does); await them so the controller's command
      // resolves only after routing+forwarding completes.
      sendMessage: async (m: unknown) => {
        const snapshot = Array.from(listeners);
        await Promise.allSettled(snapshot.map((cb) => cb(m)));
        return undefined;
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
      hasDocument: async () => docAlive,
      createDocument: async () => {
        createDocumentCalls += 1;
        docAlive = true;
        // Loading the document re-runs the offscreen entry → re-registers host.
        startHost();
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
  hostDispose?.();
  routerDispose?.();
  hostDispose = undefined;
  routerDispose = undefined;
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
    routerDispose = startAudioRouter();
    startHost();
    docAlive = true; // document already exists

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

    // Document was alive the whole time → the router must NOT recreate it.
    expect(createDocumentCalls).toBe(0);
  });

  it("resume after silence still reaches the audio element (keeps-alive AC)", async () => {
    audio = createFakeAudio();
    installBus(audio);
    routerDispose = startAudioRouter();
    startHost();
    docAlive = true;

    await audioChannel.load(silentBufferUrl());
    await audioChannel.play();
    expect(audio.playCalls).toBe(1);
    expect(createDocumentCalls).toBe(0);

    // Chrome auto-closes the AUDIO_PLAYBACK document after ~30s of silence.
    closeDoc();
    expect(docAlive).toBe(false);

    // The first resume command after silence must still reach a live host —
    // the router re-ensures the document before forwarding the command.
    await audioChannel.play();
    expect(createDocumentCalls).toBe(1);
    expect(docAlive).toBe(true);
    expect(audio.playCalls).toBe(2);

    // A subsequent command rides the now-alive document without recreating.
    await audioChannel.pause();
    expect(audio.pauseCalls).toBe(1);
    expect(createDocumentCalls).toBe(1);
  });

  it("stop after silence re-creates the document and resets the audio element", async () => {
    audio = createFakeAudio();
    installBus(audio);
    routerDispose = startAudioRouter();
    startHost();
    docAlive = true;

    await audioChannel.play();
    expect(audio.playCalls).toBe(1);

    closeDoc();
    await audioChannel.stop();

    expect(createDocumentCalls).toBe(1);
    expect(audio.pauseCalls).toBe(1);
    expect(audio.currentTime).toBe(0);
  });

  it("repeated play commands each reach the audio element", async () => {
    audio = createFakeAudio();
    installBus(audio);
    routerDispose = startAudioRouter();
    startHost();
    docAlive = true;

    await audioChannel.load(silentBufferUrl());
    await audioChannel.play();
    await audioChannel.play();

    expect(audio.playCalls).toBe(2);
    expect(audio.pauseCalls).toBe(0);
  });

  it("only the four typed audio commands are routed to the audio element", async () => {
    audio = createFakeAudio();
    installBus(audio);
    routerDispose = startAudioRouter();
    startHost();
    docAlive = true;

    // A non-audio message through the same bus must not touch the element.
    for (const cb of listeners) await cb({ type: "openSidebar" });

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
