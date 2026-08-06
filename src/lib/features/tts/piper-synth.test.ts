import type { BoundaryEvent } from "$lib/features/tts/engine";

import {
  isPiperSynthMessage,
  createPiperSynth,
  startPiperSynthHost,
  type PiperSynth,
  type PiperSynthResponse,
} from "$lib/features/tts/piper-synth";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0006 — the Piper synthesis seam (offscreen document side).
 *
 * The real WASM build is a follow-up; this seam is exercised against a FAKE
 * `PiperSynth` (the mocked WASM module) plus a fake IndexedDB holding a cached
 * model. The test asserts the host reads the cached model, hands it to the
 * synth, and responds with the synthesized audio + boundaries — the contract
 * the adapter relies on.
 */

const STORE_NAME = "voice-models";

/** Minimal faithful fake IndexedDB (get + put) shared with voice-store tests. */
class FakeReq<T> {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeStore {
  private data = new Map<string, unknown>();

  get(key: string): FakeReq<unknown> {
    const r = new FakeReq<unknown>();
    r.result = this.data.get(key);
    queueMicrotask(() => r.onsuccess?.());
    return r;
  }

  put(value: unknown, key: string): FakeReq<unknown> {
    this.data.set(key, value);
    const r = new FakeReq<unknown>();
    queueMicrotask(() => r.onsuccess?.());
    return r;
  }
}

class FakeDB {
  private stores = new Map<string, FakeStore>();
  objectStoreNames = { contains: (n: string) => this.stores.has(n) };
  createObjectStore(n: string): FakeStore {
    const s = new FakeStore();
    this.stores.set(n, s);
    return s;
  }
  transaction(): { objectStore(n: string): FakeStore } {
    return { objectStore: (n) => this.stores.get(n)! };
  }
}

type Listener = (message: unknown) => unknown;
interface FakeChrome {
  runtime: {
    onMessage: {
      listeners: Set<Listener>;
      addListener(cb: Listener): void;
      removeListener(cb: Listener): void;
    };
  };
}

function installChrome(): FakeChrome {
  const listeners = new Set<Listener>();
  const chrome: FakeChrome = {
    runtime: {
      onMessage: {
        listeners,
        addListener: (cb) => listeners.add(cb),
        removeListener: (cb) => listeners.delete(cb),
      },
    },
  };
  (globalThis as Record<string, unknown>).chrome = chrome;
  return chrome;
}

interface Saved {
  chrome?: unknown;
  indexedDB?: unknown;
}
const saved: Saved = {};

function installIDB(db: FakeDB): void {
  const g = globalThis as Record<string, unknown>;
  saved.indexedDB = g.indexedDB;
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
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
  if ("indexedDB" in saved) g.indexedDB = saved.indexedDB;
  else delete g.indexedDB;
});

describe("piper synth seam (ticket 0006)", () => {
  it("isPiperSynthMessage narrows only the synth message", () => {
    expect(
      isPiperSynthMessage({
        type: "tts:piper:synthesize",
        text: "hi",
        voiceUri: "v",
        rate: 1,
        pitch: 1,
        volume: 1,
      }),
    ).toBe(true);
    expect(isPiperSynthMessage({ type: "tts:audio:play" })).toBe(false);
    expect(isPiperSynthMessage(null)).toBe(false);
    expect(isPiperSynthMessage({ type: "tts:piper:synthesize", text: "hi" })).toBe(false);
  });

  it("createPiperSynth returns a stub that throws until the WASM build lands", async () => {
    const synth = createPiperSynth();
    await expect(
      synth.synthesize("hi", new Blob([]), { rate: 1, pitch: 1, volume: 1 }),
    ).rejects.toThrow(/follow-up/);
  });

  it("host responds to a synthesize message by reading the cached model and synthesizing", async () => {
    const db = new FakeDB();
    installIDB(db);
    const chrome = installChrome();
    // Pre-cache the model the adapter ensured.
    const modelBlob = new Blob([new Uint8Array([7, 7, 7])], { type: "application/octet-stream" });
    db.createObjectStore(STORE_NAME).put(
      { blob: modelBlob, size: 3, url: "u", storedAt: 0 },
      "voice:en_US-amy",
    );

    let receivedModel: Blob | undefined;
    const fakeSynth: PiperSynth = {
      async synthesize(text, model, _opts) {
        expect(text).toBe("Hello world");
        receivedModel = model;
        const boundaries: BoundaryEvent[] = [{ charIndex: 0, charLength: 5, text: "Hello" }];
        const response: PiperSynthResponse = {
          audio: new ArrayBuffer(4),
          boundaries,
          sampleRate: 22050,
        };
        return response;
      },
    };

    const dispose = startPiperSynthHost(fakeSynth);
    try {
      expect(chrome.runtime.onMessage.listeners.size).toBe(1);
      const listener = [...chrome.runtime.onMessage.listeners][0]!;
      const result = (await listener({
        type: "tts:piper:synthesize",
        text: "Hello world",
        voiceUri: "voice:en_US-amy",
        rate: 1,
        pitch: 1,
        volume: 1,
      })) as PiperSynthResponse;

      expect(receivedModel).toBe(modelBlob); // the cached model, not a re-download
      expect(result.boundaries).toEqual<BoundaryEvent[]>([
        { charIndex: 0, charLength: 5, text: "Hello" },
      ]);
      expect(result.audio.byteLength).toBe(4);
      expect(result.sampleRate).toBe(22050);
    } finally {
      dispose();
    }
    expect(chrome.runtime.onMessage.listeners.size).toBe(0);
  });

  it("host ignores non-piper messages", async () => {
    installIDB(new FakeDB());
    const chrome = installChrome();
    const dispose = startPiperSynthHost(createPiperSynth());
    try {
      const listener = [...chrome.runtime.onMessage.listeners][0]!;
      expect(await listener({ type: "tts:audio:play" })).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("host is a no-op (no-op disposer) without chrome.runtime.onMessage", () => {
    delete (globalThis as Record<string, unknown>).chrome;
    const dispose = startPiperSynthHost(createPiperSynth());
    expect(dispose()).toBeUndefined();
  });
});
