import type { PiperSynth, PiperSynthResponse } from "$lib/features/tts/piper-synth";

import { startAudioRouter } from "$lib/features/tts/audio-router";
import { startOffscreenAudio } from "$lib/features/tts/offscreen-audio";
import { startPiperSynthHost } from "$lib/features/tts/piper-synth";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Final-review regression test — multi-listener response selection.
 *
 * Chrome `runtime.onMessage` delivers each message to EVERY registered
 * listener, but only ONE response reaches `sendMessage`'s caller: the first
 * listener to respond wins. An async listener whose returned promise resolves
 * to `undefined` still sends `null` as the response and — if it resolves first
 * — clobbers a slower listener's real response. A listener that returns
 * `undefined` synchronously yields no response at all.
 *
 * In production a `tts:piper:synthesize` message reaches three listeners: the
 * background audio router, the offscreen audio host, and the offscreen Piper
 * synth host. The synth host alone returns a `PiperSynthResponse`; the adapter
 * reads `result.boundaries` off `sendMessage`'s return value. If the router
 * returns a promise for a message it does not handle, its fast-undefined wins
 * and the adapter silently gets `undefined` (→ TypeError, swallowed, no audio).
 *
 * This test models the multi-listener bus with first-responder-wins semantics
 * and asserts the synth host's response survives — i.e. the router does NOT
 * become the first responder for a non-audio message.
 */

interface FakeAudio {
  src: string;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

function createFakeAudio(): FakeAudio {
  return {
    src: "",
    currentTime: 0,
    play: () => Promise.resolve(),
    pause: () => {},
  };
}

/** Minimal faithful fake IndexedDB (get + put) — mirrors piper-engine.test.ts. */
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
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const n of names) if (!this.records.has(n)) throw new Error(`No object store named ${n}`);
    return { objectStore: (n) => new FakeStore(this.records.get(n)!, mode) };
  }
}

const STORE_NAME = "voice-models";
const VOICE_URI = "voice:en_US-amy-medium";

type Listener = (message: unknown) => unknown;
const listeners = new Set<Listener>();
const disposes: (() => void)[] = [];

interface Saved {
  chrome?: unknown;
  document?: unknown;
  indexedDB?: unknown;
}
const saved: Saved = {};

const mockSynthResponse: PiperSynthResponse = {
  audio: new ArrayBuffer(8),
  boundaries: [
    { charIndex: 0, charLength: 5, text: "Hello" },
    { charIndex: 6, charLength: 5, text: "world" },
  ],
  sampleRate: 22050,
};

/**
 * A fake `PiperSynth` that resolves to {@link mockSynthResponse} after a
 * microtask hop. The hop models the WASM synthesis latency that makes the
 * synth host the SLOW responder — the condition under which the router's
 * fast-undefined would clobber it pre-fix.
 */
const fakeSynth: PiperSynth = {
  async synthesize(): Promise<PiperSynthResponse> {
    await Promise.resolve(); // one microtask hop → strictly slower than the router's no-op
    return mockSynthResponse;
  },
};

/** True when `value` is a thenable (a listener returned a promise). */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as Record<PropertyKey, unknown>).then === "function"
  );
}

type SendMessage = (message: unknown) => Promise<unknown>;

/**
 * Install a fake `chrome.runtime` message bus that models Chrome's
 * multi-listener response selection: every listener receives the message, but
 * only the FIRST responder's reply reaches `sendMessage`'s caller. A listener
 * returning `undefined` synchronously yields no response; a listener returning
 * a promise contributes a candidate that resolves with the promise's value
 * (an `undefined` resolution still counts as a response and can win/clobber);
 * a sync non-`undefined` return is an immediate candidate. The first candidate
 * to settle wins; a rejected first responder yields no response. Returns the
 * installed `sendMessage` so the test can call it without re-reading the global.
 */
function installBus(audio: FakeAudio): SendMessage {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  saved.document = g.document;
  saved.indexedDB = g.indexedDB;
  listeners.clear();

  const db = new FakeDB();
  const store = db.createObjectStore(STORE_NAME);
  // Pre-cache the voice model so the synth host's getVoiceModel resolves.
  store.put(
    { blob: new Blob([new Uint8Array([1, 2, 3, 4])]), size: 4, url: "u", storedAt: 0 },
    VOICE_URI,
  );

  g.indexedDB = {
    open() {
      const r = new FakeReq<FakeDB>();
      queueMicrotask(() => {
        r.result = db;
        r.onsuccess?.();
      });
      return r;
    },
  };

  const sendMessage: SendMessage = async (m: unknown): Promise<unknown> => {
    const snapshot = Array.from(listeners);
    type Candidate = Promise<{ value: unknown } | { rejected: true }>;
    const candidates: Candidate[] = [];
    for (const cb of snapshot) {
      let result: unknown;
      try {
        result = cb(m);
      } catch {
        continue; // a throwing listener contributes no response
      }
      if (result === undefined) continue; // sync undefined → no response (yields)
      if (isPromiseLike(result)) {
        candidates.push(
          result.then(
            (v) => ({ value: v }),
            () => ({ rejected: true as const }),
          ),
        );
      } else {
        candidates.push(Promise.resolve({ value: result }));
      }
    }
    if (candidates.length === 0) return undefined;
    const winner = await Promise.race(candidates);
    if ("rejected" in winner) return undefined; // first responder rejected → no response
    return winner.value;
  };

  g.chrome = {
    runtime: {
      onMessage: {
        addListener(cb: Listener) {
          listeners.add(cb);
        },
        removeListener(cb: Listener) {
          listeners.delete(cb);
        },
      },
      sendMessage,
    },
    offscreen: {
      hasDocument: async () => true,
      createDocument: async () => {},
    },
  };
  g.document = { createElement: (tag: string) => (tag === "audio" ? audio : null) };
  return sendMessage;
}

function restore(): void {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
  if ("document" in saved) g.document = saved.document;
  else delete g.document;
  if ("indexedDB" in saved) g.indexedDB = saved.indexedDB;
  else delete g.indexedDB;
  listeners.clear();
}

afterEach(() => {
  for (const d of disposes) d();
  disposes.length = 0;
  restore();
});

describe("audio-router multi-listener response selection (final review)", () => {
  it("a tts:piper:synthesize message resolves to the synth host response, not the router's undefined", async () => {
    const audio = createFakeAudio();
    const sendMessage = installBus(audio);

    // Registration order mirrors production: background router, offscreen
    // audio host, offscreen Piper synth host.
    disposes.push(startAudioRouter());
    disposes.push(startOffscreenAudio());
    disposes.push(startPiperSynthHost(fakeSynth));

    const message = {
      type: "tts:piper:synthesize",
      text: "Hello world",
      voiceUri: VOICE_URI,
      rate: 1,
      pitch: 1,
      volume: 1,
    };

    const result = await sendMessage(message);

    // The synth host's PiperSynthResponse must win — the router's fast
    // undefined (pre-fix) must NOT clobber it.
    expect(result).toBe(mockSynthResponse);
  });
});
