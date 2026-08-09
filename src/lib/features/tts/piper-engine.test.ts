import type { BoundaryEvent, SpeakOpts, Voice } from "$lib/features/tts/engine";
import type { PiperSynthResponse } from "$lib/features/tts/piper-synth";

import { createPiperEngine, type PiperVoiceModel } from "$lib/features/tts/piper-engine";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Ticket 0006 — WASM Piper adapter over the `Engine` contract.
 *
 * The WASM synth module (offscreen side) and the IndexedDB storage layer are
 * mocked; the adapter, the caching policy (download-on-first-use /
 * read-on-subsequent / no-re-download), and the audio playback wiring are REAL
 * and asserted through observable behavior:
 *
 * - speak → ensure model cached → synth → buffer → play over the audio channel
 * - first use downloads; second use reads from IDB with NO re-download
 * - boundary events relay through `onBoundary`
 * - stop/pause/resume delegate to the audio channel
 */

const STORE_NAME = "voice-models";

/** Minimal faithful fake IndexedDB (get + put). */
class FakeReq<T> {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeStore {
  constructor(
    private records: Map<string, unknown>,
    private mode: IDBTransactionMode,
  ) {}

  get(key: string): FakeReq<unknown> {
    const r = new FakeReq<unknown>();
    r.result = this.records.get(key);
    queueMicrotask(() => r.onsuccess?.());
    return r;
  }

  put(value: unknown, key: string): FakeReq<unknown> {
    const r = new FakeReq<unknown>();
    if (this.mode === "readonly") {
      r.error = new DOMException("put in readonly transaction", "ReadOnlyError");
      queueMicrotask(() => r.onerror?.());
      return r;
    }
    this.records.set(key, value);
    queueMicrotask(() => r.onsuccess?.());
    return r;
  }
}

class FakeDB {
  private records = new Map<string, Map<string, unknown>>();
  objectStoreNames = { contains: (n: string) => this.records.has(n) };
  createObjectStore(n: string): FakeStore {
    const m = new Map<string, unknown>();
    this.records.set(n, m);
    return new FakeStore(m, "versionchange");
  }
  transaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = "readonly",
  ): { objectStore(n: string): FakeStore } {
    if (storeNames === undefined || storeNames === null) {
      throw new TypeError("Failed to execute 'transaction' on 'IDBDatabase': 1 argument required");
    }
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const n of names)
      if (!this.records.has(n)) throw new Error(`No object store named ${String(n)}`);
    return { objectStore: (n) => new FakeStore(this.records.get(n)!, mode) };
  }
}

/** A recorded runtime message with its `type` narrowed without an inline cast. */
interface Sent {
  readonly type: string;
  readonly message: unknown;
}

/** Narrows a runtime message to its string `type` (or `undefined`). */
function typeOf(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || !("type" in message)) return undefined;
  const t = message.type;
  return typeof t === "string" ? t : undefined;
}

/** Reads the `src` from a `tts:audio:load` message, narrowed via guards. */
function loadSrc(messages: Sent[]): string | undefined {
  const found = messages.find((s) => s.type === "tts:audio:load")?.message;
  if (!found || typeof found !== "object" || !("src" in found)) return undefined;
  const src = found.src;
  return typeof src === "string" ? src : undefined;
}

/**
 * Captures `unhandledRejection` events during a window so a fire-and-forget
 * pipeline that leaks a rejection is observable. `process` is the node test
 * global; vitest surfaces unhandled rejections, but asserting `caught` keeps
 * the test deterministic and self-describing.
 */
function captureUnhandled(): { caught: unknown[]; stop: () => void } {
  const caught: unknown[] = [];
  const handler = (reason: unknown): void => {
    caught.push(reason);
  };
  process.on("unhandledRejection", handler);
  return { caught, stop: () => process.off("unhandledRejection", handler) };
}

const sent: Sent[] = [];
/** onMessage listeners registered by `audioChannel.onEnded` (faked bus). */
const onMessageListeners = new Set<(msg: unknown) => void>();
let fetchCalls = 0;
let blobCounter = 0;
const mockBoundaries: BoundaryEvent[] = [
  { charIndex: 0, charLength: 5, text: "Hello" },
  { charIndex: 6, charLength: 5, text: "world" },
];
const mockSynthResponse: PiperSynthResponse = {
  audio: new ArrayBuffer(8),
  boundaries: mockBoundaries,
  sampleRate: 22050,
};

interface Saved {
  chrome?: unknown;
  indexedDB?: unknown;
  fetch?: unknown;
  createObjectURL?: unknown;
}
const saved: Saved = {};

const VOICES: PiperVoiceModel[] = [
  {
    voiceUri: "voice:en_US-amy-medium",
    name: "Amy (en_US, medium)",
    lang: "en-US",
    url: "https://models.openwebtts/en_US-amy-medium.onnx",
    size: 63_000_000,
  },
];

function install(opts: { loadRejects?: boolean } = {}): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  saved.indexedDB = g.indexedDB;
  saved.fetch = g.fetch;
  saved.createObjectURL = URL.createObjectURL.bind(URL);

  fetchCalls = 0;
  blobCounter = 0;
  sent.length = 0;
  onMessageListeners.clear();

  const db = new FakeDB();
  g.indexedDB = {
    open() {
      const r = new FakeReq<FakeDB>();
      queueMicrotask(() => {
        r.result = db;
        if (!db.objectStoreNames.contains(STORE_NAME)) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  g.fetch = async (_url: string) => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      blob: async () =>
        new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/octet-stream" }),
    } as Response;
  };
  g.chrome = {
    runtime: {
      sendMessage: async (m: unknown) => {
        sent.push({ type: typeOf(m) ?? "?", message: m });
        if (typeOf(m) === "tts:piper:synthesize") return mockSynthResponse;
        if (opts.loadRejects && typeOf(m) === "tts:audio:load") {
          throw new Error("load rejected mid-flight");
        }
        return undefined;
      },
      onMessage: {
        addListener(cb: (msg: unknown) => void) {
          onMessageListeners.add(cb);
        },
        removeListener(cb: (msg: unknown) => void) {
          onMessageListeners.delete(cb);
        },
      },
    },
  };
  URL.createObjectURL = ((): string => `blob:fake/${++blobCounter}`) as typeof URL.createObjectURL;
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
  if ("indexedDB" in saved) g.indexedDB = saved.indexedDB;
  else delete g.indexedDB;
  if ("fetch" in saved) g.fetch = saved.fetch;
  else delete g.fetch;
  if ("createObjectURL" in saved)
    URL.createObjectURL = saved.createObjectURL as typeof URL.createObjectURL;
  sent.length = 0;
  onMessageListeners.clear();
});

/** Fires a `tts:audio:ended` message to every registered onMessage listener. */
function dispatchEnded(): void {
  for (const cb of onMessageListeners) cb({ type: "tts:audio:ended" });
}

const OPTS: SpeakOpts = { rate: 1, pitch: 1, volume: 1, voiceUri: "voice:en_US-amy-medium" };

describe("WASM Piper adapter (ticket 0006)", () => {
  it("speak → buffer → play: synthesizes, loads the audio buffer, and plays it via the audio channel", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    engine.speak("Hello world", OPTS);

    // speak is fire-and-forget; wait for the audio channel to receive load + play.
    await vi.waitFor(() => {
      expect(sent.map((s) => s.type)).toContain("tts:audio:load");
      expect(sent.map((s) => s.type)).toContain("tts:audio:play");
    });

    expect(loadSrc(sent)).toBe("blob:fake/1"); // derived from the synthesized buffer

    // The synth (offscreen) message was sent with the voiceUri and text.
    const synth = sent.find((s) => s.type === "tts:piper:synthesize")?.message as
      | { type: string; text: string; voiceUri: string }
      | undefined;
    expect(synth?.text).toBe("Hello world");
    expect(synth?.voiceUri).toBe("voice:en_US-amy-medium");
  });

  it("downloads the model on first use and reads from IndexedDB on second use (no re-download)", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    engine.speak("Hello world", OPTS);
    await vi.waitFor(() => expect(sent.some((s) => s.type === "tts:audio:play")).toBe(true));
    expect(fetchCalls).toBe(1);

    // Second utterance must NOT re-download the ~30–60MB model.
    engine.speak("Second sentence", OPTS);
    await vi.waitFor(() => expect(sent.filter((s) => s.type === "tts:audio:play").length).toBe(2));
    expect(fetchCalls).toBe(1); // no re-download
  });

  it("relays synthesizer boundary events through onBoundary", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const events: BoundaryEvent[] = [];
    engine.onBoundary((e) => events.push(e));

    engine.speak("Hello world", OPTS);
    await vi.waitFor(() => expect(events.length).toBe(mockBoundaries.length));

    expect(events).toEqual<BoundaryEvent[]>(mockBoundaries);
  });

  it("onBoundary disposer stops further boundary delivery", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const events: BoundaryEvent[] = [];
    const dispose = engine.onBoundary((e) => events.push(e));
    dispose();

    engine.speak("Hello world", OPTS);
    await vi.waitFor(() => expect(sent.some((s) => s.type === "tts:audio:play")).toBe(true));
    expect(events).toHaveLength(0);
  });

  it("stop/pause/resume delegate to the audio channel", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    engine.stop();
    engine.pause();
    engine.resume();

    await Promise.resolve();
    expect(sent.map((s) => s.type)).toEqual([
      "tts:audio:stop",
      "tts:audio:pause",
      "tts:audio:play",
    ]);
  });

  it("getVoices returns the catalog mapped to the Voice contract (Piper models are local)", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const voices = await engine.getVoices();

    expect(voices).toEqual<Voice[]>([
      {
        name: "Amy (en_US, medium)",
        lang: "en-US",
        voiceUri: "voice:en_US-amy-medium",
        isLocal: true,
      },
    ]);
  });

  it("onVoicesChanged disposer stops delivery (catalog is static, no events fire)", () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const seen: Voice[][] = [];
    const dispose = engine.onVoicesChanged((v) => seen.push(v));
    dispose();
    expect(seen).toHaveLength(0);
  });

  it("speak is a no-op (does not throw) when the voice is not in the catalog", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    expect(() =>
      engine.speak("hi", { rate: 1, pitch: 1, volume: 1, voiceUri: "voice:unknown" }),
    ).not.toThrow();
    await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it("a throwing onBoundary callback does not abort playback or surface an unhandled rejection", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const cap = captureUnhandled();
    try {
      engine.onBoundary(() => {
        throw new Error("buggy boundary callback");
      });
      engine.speak("Hello world", OPTS);

      // Playback must still proceed despite the throwing callback; vi.waitFor
      // polls past the microtask drain, so a leaked rejection would already
      // be in `cap.caught` by the time this resolves.
      await vi.waitFor(() => expect(sent.some((s) => s.type === "tts:audio:play")).toBe(true));
      expect(cap.caught).toHaveLength(0);
    } finally {
      cap.stop();
    }
  });

  it("an audioChannel.load rejection mid-flight degrades gracefully with no unhandled rejection", async () => {
    install({ loadRejects: true });
    const engine = createPiperEngine({ voices: VOICES });

    const cap = captureUnhandled();
    try {
      engine.speak("Hello world", OPTS);

      // synth resolves, load rejects, play must NOT be sent. Wait for the load
      // attempt (the observable signal), by which point a leaked rejection
      // would already be captured.
      await vi.waitFor(() => expect(sent.some((s) => s.type === "tts:audio:load")).toBe(true));
      expect(sent.some((s) => s.type === "tts:audio:play")).toBe(false);
      expect(cap.caught).toHaveLength(0);
    } finally {
      cap.stop();
    }
  });

  it("imports and degrades safely with no chrome/indexedDB globals", async () => {
    const g = globalThis as Record<string, unknown>;
    delete g.chrome;
    delete g.indexedDB;
    const engine = createPiperEngine({ voices: VOICES });

    await expect(engine.getVoices()).resolves.toEqual([
      {
        name: "Amy (en_US, medium)",
        lang: "en-US",
        voiceUri: "voice:en_US-amy-medium",
        isLocal: true,
      },
    ]);
    // speak kicks off a pipeline that rejects (no IDB) and is swallowed.
    expect(() => engine.speak("hi", OPTS)).not.toThrow();
    expect(() => engine.stop()).not.toThrow();
  });

  it("onEnd fires after the audio ends", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const ended: number[] = [];
    engine.onEnd(() => ended.push(1));

    engine.speak("Hello world", OPTS);
    await vi.waitFor(() => expect(sent.some((s) => s.type === "tts:audio:play")).toBe(true));

    dispatchEnded();
    await vi.waitFor(() => expect(ended.length).toBe(1));
  });

  it("stop() before end suppresses onEnd", async () => {
    install();
    const engine = createPiperEngine({ voices: VOICES });

    const ended: number[] = [];
    engine.onEnd(() => ended.push(1));

    engine.speak("Hello world", OPTS);
    await vi.waitFor(() => expect(sent.some((s) => s.type === "tts:audio:play")).toBe(true));

    engine.stop(); // bumps currentToken; the pending `ended` is now superseded
    dispatchEnded();
    await Promise.resolve();
    expect(ended).toHaveLength(0);
  });
});
