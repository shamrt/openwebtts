/**
 * Ticket 0014 — tests for the overlay store's skip-to-section surface.
 *
 * The slider's data (heading markers), its seek behavior, and the current
 * heading readout all live behind the overlay store seam; the E2E spec
 * (`e2e/navigation.spec.ts`) covers the rendered slider itself.
 */

import type { ReaderSettings } from "$lib/features/settings/settings.js";
import type {
  BoundaryEvent,
  EngineController,
  EngineSelection,
  ResolvedEngine,
  Voice,
} from "$lib/features/tts";

import { createSettingsStore, type StorageArea } from "$lib/features/settings/settings.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOverlayStore } from "./overlay-store.js";

function fixture(html: string): Document {
  const doc = document.implementation.createHTMLDocument("Fixture");
  doc.body.innerHTML = html;
  return doc;
}

// Readability folds an h1 matching the <title> into the article title; an
// h1 that differs stays in the content (normalized to h2). The fixture below
// therefore yields heading chunks at 0, 2, 4.
const ARTICLE = `
  <article>
    <h1>Intro</h1>
    <p>Para one.</p>
    <h2>Section A</h2>
    <p>Para two.</p>
    <h2>Section B</h2>
    <p>Para three.</p>
  </article>
`;

describe("createOverlayStore skip-to-section", () => {
  it("exposes heading markers from the extractor's heading metadata", () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();
    expect(store.headings).toEqual([
      { chunkIndex: 0, text: "Intro" },
      { chunkIndex: 2, text: "Section A" },
      { chunkIndex: 4, text: "Section B" },
    ]);
    vi.unstubAllGlobals();
  });

  it("seek moves the reading position to the heading's chunk", () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();
    store.seek(store.headings[1]!.chunkIndex);
    expect(store.currentHeadingIndex).toBe(1);
    expect(store.currentChunk?.headingText).toBe("Section A");
    // Chunk 2 of 6 → 2/5 = 40%.
    expect(store.positionPercent).toBe(40);
    vi.unstubAllGlobals();
  });

  it("reports the current heading for the active section", () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();
    expect(store.currentHeadingIndex).toBe(0); // Intro
    store.seek(3); // paragraph inside Section A (2nd heading)
    expect(store.currentHeadingIndex).toBe(1);
    store.seek(5); // paragraph inside Section B (3rd heading)
    expect(store.currentHeadingIndex).toBe(2);
    vi.unstubAllGlobals();
  });

  it("has no markers and a null heading when the article has no headings", () => {
    vi.stubGlobal(
      "document",
      fixture("<article><p>Only paragraphs.</p><p>More text.</p></article>"),
    );
    const store = createOverlayStore();
    expect(store.headings).toEqual([]);
    expect(store.currentHeadingIndex).toBeNull();
    vi.unstubAllGlobals();
  });
});

/**
 * Ticket 0015 — tests for the settings surface of the overlay store.
 *
 * The settings panel (voice list, speed/pitch/volume, highlighting
 * granularity) reads voices from the active engine and persists every field
 * through the settings store. These tests cover the overlay-store seam: voice
 * listing from the resolved engine, voice/pitch persistence round-trips, and
 * the settings/engine/voice change events the UI bridges to Svelte stores.
 */

const VOICE_ALEX: Voice = { name: "Alex", lang: "en-US", voiceUri: "ws:alex", isLocal: false };
const VOICE_AMY: Voice = { name: "Amy", lang: "en-US", voiceUri: "piper:amy", isLocal: true };

/** A controllable engine-controller fake: per-kind voice catalogs, selection
 * flips `currentEngine` and notifies, and `_emitVoicesChanged` drives the
 * voiceschanged path. Mirrors the real controller's contract (0007). */
function fakeEngineController(
  voicesByKind: Record<ResolvedEngine, Voice[]>,
  initial: ResolvedEngine = "web-speech",
): EngineController & {
  _emitVoicesChanged(voices: Voice[]): void;
  _emitBoundary(e: BoundaryEvent): void;
  _emitEnd(): void;
  speaks: string[];
} {
  let kind: ResolvedEngine = initial;
  const currentCbs = new Set<(e: ResolvedEngine) => void>();
  const voiceCbs = new Set<(v: Voice[]) => void>();
  const boundaryCbs = new Set<(e: BoundaryEvent) => void>();
  const endCbs = new Set<() => void>();
  const speaks: string[] = [];

  return {
    speaks,
    speak(text: string): void {
      speaks.push(text);
    },
    stop(): void {},
    pause(): void {},
    resume(): void {},
    async getVoices(): Promise<Voice[]> {
      return voicesByKind[kind];
    },
    onVoicesChanged(cb: (v: Voice[]) => void): () => void {
      voiceCbs.add(cb);
      return () => voiceCbs.delete(cb);
    },
    onBoundary(cb: (e: BoundaryEvent) => void): () => void {
      boundaryCbs.add(cb);
      return () => boundaryCbs.delete(cb);
    },
    onEnd(cb: () => void): () => void {
      endCbs.add(cb);
      return () => endCbs.delete(cb);
    },
    getCurrentEngine(): ResolvedEngine {
      return kind;
    },
    onCurrentEngine(cb: (e: ResolvedEngine) => void): () => void {
      currentCbs.add(cb);
      return () => currentCbs.delete(cb);
    },
    getSelection(): EngineSelection {
      return kind;
    },
    async setSelection(next: EngineSelection): Promise<void> {
      if (next === "auto" || next === kind) return;
      kind = next;
      for (const cb of currentCbs) cb(kind);
    },
    _emitVoicesChanged(next: Voice[]): void {
      for (const cb of voiceCbs) cb(next);
    },
    _emitBoundary(e: BoundaryEvent): void {
      for (const cb of boundaryCbs) cb(e);
    },
    _emitEnd(): void {
      for (const cb of endCbs) cb();
    },
  };
}

function createMemoryStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    async get(key: string): Promise<unknown> {
      return data.get(key);
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
    },
  };
}

describe("createOverlayStore settings (ticket 0015)", () => {
  it("lists voices from the active engine", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController(
      { "web-speech": [VOICE_ALEX], piper: [VOICE_AMY] },
      "web-speech",
    );
    const store = createOverlayStore({ engineController: controller });
    await store.ready;

    expect(store.voices).toEqual([VOICE_ALEX]);
    vi.unstubAllGlobals();
  });

  it("refreshes voices when the engine changes", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController(
      { "web-speech": [VOICE_ALEX], piper: [VOICE_AMY] },
      "web-speech",
    );
    const store = createOverlayStore({ engineController: controller });
    await store.ready;
    expect(store.voices.map((v) => v.voiceUri)).toEqual(["ws:alex"]);

    await store.setEngine("piper");

    expect(store.engineKind).toBe("piper");
    expect(store.voices.map((v) => v.voiceUri)).toEqual(["piper:amy"]);
    vi.unstubAllGlobals();
  });

  it("updates voices when the active engine emits voiceschanged", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController({ "web-speech": [], piper: [] }, "web-speech");
    const store = createOverlayStore({ engineController: controller });
    await store.ready;
    expect(store.voices).toEqual([]);

    controller._emitVoicesChanged([VOICE_ALEX]);

    expect(store.voices).toEqual([VOICE_ALEX]);
    vi.unstubAllGlobals();
  });

  it("setVoice persists the chosen voice across sessions", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const storage = createMemoryStorage();
    const settingsStore = createSettingsStore(storage);
    const store = createOverlayStore({
      settingsStore,
      engineController: fakeEngineController({ "web-speech": [VOICE_ALEX], piper: [] }),
    });
    await store.ready;

    await store.setVoice("ws:alex");
    expect(store.settings.voiceUri).toBe("ws:alex");

    const reloaded = createSettingsStore(storage);
    await reloaded.loaded;
    expect(reloaded.get().voiceUri).toBe("ws:alex");
    vi.unstubAllGlobals();
  });

  it("setPitch persists the pitch across sessions", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const storage = createMemoryStorage();
    const settingsStore = createSettingsStore(storage);
    const store = createOverlayStore({
      settingsStore,
      engineController: fakeEngineController({ "web-speech": [VOICE_ALEX], piper: [] }),
    });
    await store.ready;

    await store.setPitch(1.2);
    expect(store.settings.pitch).toBe(1.2);

    const reloaded = createSettingsStore(storage);
    await reloaded.loaded;
    expect(reloaded.get().pitch).toBe(1.2);
    vi.unstubAllGlobals();
  });

  it("emits settings changes to listeners", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const storage = createMemoryStorage();
    const settingsStore = createSettingsStore(storage);
    const store = createOverlayStore({
      settingsStore,
      engineController: fakeEngineController({ "web-speech": [VOICE_ALEX], piper: [] }),
    });
    await store.ready;

    const seen: ReaderSettings[] = [];
    const dispose = store.onSettingsChange((s) => seen.push(s));

    await store.setVoice("ws:alex");
    await store.setPitch(1.2);

    expect(seen.at(-1)?.voiceUri).toBe("ws:alex");
    expect(seen.at(-1)?.pitch).toBe(1.2);
    dispose();
    vi.unstubAllGlobals();
  });

  it("notifies engine changes to listeners", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController(
      { "web-speech": [VOICE_ALEX], piper: [VOICE_AMY] },
      "web-speech",
    );
    const store = createOverlayStore({ engineController: controller });
    const seen: ResolvedEngine[] = [];
    const dispose = store.onEngineChange((k) => seen.push(k));

    await store.ready;
    await store.setEngine("piper");

    expect(seen).toEqual(["web-speech", "piper"]);
    dispose();
    vi.unstubAllGlobals();
  });
});

/**
 * Ticket 0013 (bugs 1–3) — boundary vs end semantics + activation gate.
 *
 * Web Speech fires a `boundary` event per word; the overlay must NOT advance the
 * reading position on a boundary (bug 3) — only highlight within the chunk.
 * Chunk-to-chunk advance happens on `onEnd` (bug 2): speak the next chunk, or
 * go idle at the end. The overlay is hidden until `activate()` is called (bug 1).
 */
describe("createOverlayStore playback continuation + activation (bugs 1-3)", () => {
  it("boundary does not advance reading position", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController({ "web-speech": [VOICE_ALEX], piper: [] });
    const store = createOverlayStore({ engineController: controller });
    await store.ready;
    store.setHighlightMode("paragraph");
    const before = store.positionPercent;
    const beforeChunk = store.currentChunk?.text;

    store.play();
    // Web Speech fires a boundary per word; several in a row must NOT advance.
    controller._emitBoundary({ charIndex: 0 });
    controller._emitBoundary({ charIndex: 4 });
    controller._emitBoundary({ charIndex: 8 });

    expect(store.positionPercent).toBe(before);
    expect(store.currentChunk?.text).toBe(beforeChunk);
    vi.unstubAllGlobals();
  });

  it("onEnd advances to and speaks the next chunk", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController({ "web-speech": [VOICE_ALEX], piper: [] });
    const store = createOverlayStore({ engineController: controller });
    await store.ready;

    store.play();
    // Let the play() microtask speak chunk 0 before we end it.
    await Promise.resolve();
    const spokeBefore = controller.speaks.length;

    controller._emitEnd();

    expect(store.positionPercent).toBeGreaterThan(0);
    // speakCurrent was called for the next chunk.
    expect(controller.speaks.length).toBeGreaterThan(spokeBefore);
    expect(controller.speaks.at(-1)).toBe(store.currentChunk?.text);
    vi.unstubAllGlobals();
  });

  it("onEnd at the last chunk stops playback", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const controller = fakeEngineController({ "web-speech": [VOICE_ALEX], piper: [] });
    const store = createOverlayStore({ engineController: controller });
    await store.ready;

    // ARTICLE yields 6 chunks (0..5); seek to the final chunk.
    store.seek(5);
    store.play();
    await Promise.resolve(); // let speakCurrent run for the last chunk
    const spokeAtPlay = controller.speaks.length;

    controller._emitEnd();

    expect(store.state.status).toBe("idle");
    // Stopping at the end does not schedule an extra speak beyond the last.
    expect(controller.speaks.length).toBe(spokeAtPlay);
    vi.unstubAllGlobals();
  });

  it("activated gates the overlay and activate() enables it", async () => {
    vi.stubGlobal("document", fixture(ARTICLE));
    const store = createOverlayStore();

    expect(store.activated).toBe(false);
    const seen: boolean[] = [];
    const dispose = store.onActivatedChange((a) => seen.push(a));

    store.activate();

    expect(store.activated).toBe(true);
    expect(seen).toEqual([true]);
    dispose();
    vi.unstubAllGlobals();
  });
});
