import type { BoundaryEvent, Engine, SpeakOpts, Voice } from "$lib/features/tts/engine";
import type { WebSpeechEngine } from "$lib/features/tts/web-speech-engine";

import { createEngineController, type EngineSelection } from "$lib/features/tts/engine-controller";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0007 — engine selection / fallback controller.
 *
 * The controller owns the hybrid TTS decision (Web Speech first, Piper on empty
 * voices) and is the seam the UI (0013) and settings panel (0015) talk to. The
 * two engines are injected as fakes so the fallback decision, the selection
 * persistence, and the `currentEngine` observable are the REAL behavior under
 * test — not the engines themselves (covered by their own tickets).
 *
 * Seams under test (agreed per the ticket's acceptance criteria):
 * - speak routes to the resolved engine (Web Speech when it has voices, else Piper)
 * - selection is persisted to `chrome.storage.local` and reloaded by a new controller
 * - `currentEngine` observable fires on resolve / selection / voices-changed flips
 */

interface RecordedSpeak {
  text: string;
  opts: SpeakOpts;
}

/** A controllable Web Speech fake. `hasVoices` + an async voices list are the
 * only pieces the controller reads; `speak` is recorded so routing is observed. */
function fakeWebSpeech(initialHasVoices: boolean): WebSpeechEngine & {
  _setHasVoices(has: boolean): void;
  _emitsVoicesChanged(): void;
  _emitEnd(): void;
  speaks: RecordedSpeak[];
} {
  const speaks: RecordedSpeak[] = [];
  let has = initialHasVoices;
  const voiceCbs = new Set<(voices: Voice[]) => void>();
  const boundaryCbs = new Set<(e: BoundaryEvent) => void>();
  const endCbs = new Set<() => void>();

  const voices = (): Voice[] =>
    has ? [{ name: "WS Voice", lang: "en-US", voiceUri: "ws:en", isLocal: false }] : [];

  return {
    speak(text: string, opts: SpeakOpts): void {
      speaks.push({ text, opts });
      // Simulate a boundary emission so relay routing is observable.
      for (const cb of boundaryCbs) cb({ charIndex: 0, charLength: text.length, text });
    },
    stop(): void {},
    pause(): void {},
    resume(): void {},
    async getVoices(): Promise<Voice[]> {
      return voices();
    },
    onVoicesChanged(cb: (voices: Voice[]) => void): () => void {
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
    hasVoices(): boolean {
      return has;
    },
    _setHasVoices(next: boolean): void {
      has = next;
    },
    _emitEnd(): void {
      for (const cb of endCbs) cb();
    },
    _emitsVoicesChanged(): void {
      for (const cb of voiceCbs) cb(voices());
    },
    speaks,
  };
}

/** A Piper fake that records `speak` so fallback routing is observable. */
function fakePiper(): Engine & {
  speaks: RecordedSpeak[];
  _emitsVoicesChanged(): void;
  _emitEnd(): void;
} {
  const speaks: RecordedSpeak[] = [];
  const boundaryCbs = new Set<(e: BoundaryEvent) => void>();
  const voiceCbs = new Set<(voices: Voice[]) => void>();
  const endCbs = new Set<() => void>();
  const voices = (): Voice[] => [
    { name: "Piper Amy", lang: "en-US", voiceUri: "piper:en_US-amy", isLocal: true },
  ];
  return {
    speak(text: string, opts: SpeakOpts): void {
      speaks.push({ text, opts });
      for (const cb of boundaryCbs) cb({ charIndex: 0, charLength: text.length, text });
    },
    stop(): void {},
    pause(): void {},
    resume(): void {},
    async getVoices(): Promise<Voice[]> {
      return voices();
    },
    onVoicesChanged(cb: (voices: Voice[]) => void): () => void {
      voiceCbs.add(cb);
      return () => voiceCbs.delete(cb);
    },
    onEnd(cb: () => void): () => void {
      endCbs.add(cb);
      return () => endCbs.delete(cb);
    },
    onBoundary(cb: (e: BoundaryEvent) => void): () => void {
      boundaryCbs.add(cb);
      return () => boundaryCbs.delete(cb);
    },
    _emitEnd(): void {
      for (const cb of endCbs) cb();
    },
    _emitsVoicesChanged(): void {
      for (const cb of voiceCbs) cb(voices());
    },
    speaks,
  };
}

interface Saved {
  chrome?: unknown;
}

const saved: Saved = {};
const store: Record<string, unknown> = {};

function installStorage(opts: { getThrows?: boolean } = {}): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  for (const k of Object.keys(store)) delete store[k];
  g.chrome = {
    storage: {
      async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
        if (opts.getThrows) throw new Error("storage get failed");
        const want = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of want) if (k in store) out[k] = store[k];
        return out;
      },
      async set(items: Record<string, unknown>): Promise<void> {
        Object.assign(store, items);
      },
    },
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
  for (const k of Object.keys(store)) delete store[k];
});

const OPTS: SpeakOpts = { rate: 1, pitch: 1, volume: 1, voiceUri: "ws:en" };

describe("engine selection / fallback controller (ticket 0007)", () => {
  it("routes speak to Web Speech when it has voices (auto selection)", async () => {
    installStorage();
    const ws = fakeWebSpeech(true);
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    controller.speak("Hello", OPTS);

    expect(ws.speaks).toHaveLength(1);
    expect(ws.speaks[0]?.text).toBe("Hello");
    expect(piper.speaks).toHaveLength(0);
    expect(controller.getCurrentEngine()).toBe("web-speech");
  });

  it("falls back to Piper when Web Speech has no voices (auto selection)", async () => {
    installStorage();
    const ws = fakeWebSpeech(false);
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    controller.speak("Hello", { ...OPTS, voiceUri: "piper:en_US-amy" });

    expect(piper.speaks).toHaveLength(1);
    expect(piper.speaks[0]?.text).toBe("Hello");
    expect(ws.speaks).toHaveLength(0);
    expect(controller.getCurrentEngine()).toBe("piper");
  });

  it("re-resolves to Web Speech when voices arrive after startup (voiceschanged)", async () => {
    installStorage();
    const ws = fakeWebSpeech(false); // Firefox Android: empty at startup
    const piper = fakePiper();
    const seen: string[] = [];
    const controller = await createEngineController({ webSpeech: ws, piper });
    controller.onCurrentEngine((e) => seen.push(e));

    expect(controller.getCurrentEngine()).toBe("piper");

    // Voices populate later (the Web Speech `voiceschanged` event).
    ws._setHasVoices(true);
    ws._emitsVoicesChanged();

    expect(controller.getCurrentEngine()).toBe("web-speech");
    expect(seen).toContain("web-speech");
  });

  it("setSelection persists the override and a new controller reloads it", async () => {
    installStorage();
    const ws = fakeWebSpeech(true); // would normally pick Web Speech
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    await controller.setSelection("piper");

    // Forced to Piper even though Web Speech has voices.
    controller.speak("forced", { ...OPTS, voiceUri: "piper:en_US-amy" });
    expect(piper.speaks).toHaveLength(1);
    expect(ws.speaks).toHaveLength(0);

    // A fresh controller hydrates the persisted selection from storage.
    const reloaded = await createEngineController({
      webSpeech: fakeWebSpeech(true),
      piper: fakePiper(),
    });
    expect(reloaded.getSelection()).toBe("piper");
    expect(reloaded.getCurrentEngine()).toBe("piper");
  });

  it("setSelection('auto') reverts to the voices-driven decision", async () => {
    installStorage();
    const ws = fakeWebSpeech(true);
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    await controller.setSelection("piper");
    expect(controller.getCurrentEngine()).toBe("piper");

    await controller.setSelection("auto");
    expect(controller.getSelection()).toBe("auto");
    expect(controller.getCurrentEngine()).toBe("web-speech");
  });

  it("currentEngine observable notifies on selection change and disposer stops delivery", async () => {
    installStorage();
    const ws = fakeWebSpeech(true);
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    const seen: string[] = [];
    const dispose = controller.onCurrentEngine((e) => seen.push(e));

    await controller.setSelection("piper");
    await controller.setSelection("web-speech");

    expect(seen).toEqual(["piper", "web-speech"]);
    dispose();

    await controller.setSelection("piper");
    // No further delivery after dispose.
    expect(seen).toEqual(["piper", "web-speech"]);
  });

  it("stop/pause/resume delegate to the resolved engine", async () => {
    installStorage();
    let wsStopped = false;
    let wsPaused = false;
    let wsResumed = false;
    const ws = fakeWebSpeech(true);
    ws.stop = () => {
      wsStopped = true;
    };
    ws.pause = () => {
      wsPaused = true;
    };
    ws.resume = () => {
      wsResumed = true;
    };
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    controller.stop();
    controller.pause();
    controller.resume();

    expect([wsStopped, wsPaused, wsResumed]).toEqual([true, true, true]);
  });

  it("getVoices returns the resolved engine's voice list", async () => {
    installStorage();
    const controller = await createEngineController({
      webSpeech: fakeWebSpeech(false),
      piper: fakePiper(),
    });

    const voices = await controller.getVoices();

    expect(voices).toEqual<Voice[]>([
      { name: "Piper Amy", lang: "en-US", voiceUri: "piper:en_US-amy", isLocal: true },
    ]);
  });

  it("onBoundary relays boundary events from the active engine only", async () => {
    installStorage();
    const ws = fakeWebSpeech(false); // active engine is Piper
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    const events: BoundaryEvent[] = [];
    controller.onBoundary((e) => events.push(e));

    controller.speak("Hello", { ...OPTS, voiceUri: "piper:en_US-amy" });
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toBe("Hello");
  });

  it("hydrates with defaults when storage is absent (no chrome global)", async () => {
    const g = globalThis as Record<string, unknown>;
    delete g.chrome;

    const controller = await createEngineController({
      webSpeech: fakeWebSpeech(false),
      piper: fakePiper(),
    });

    expect(controller.getSelection()).toBe("auto");
    expect(controller.getCurrentEngine()).toBe("piper");
    // setSelection persists gracefully (no chrome.storage → swallowed, selection still applied in-memory).
    await expect(controller.setSelection("piper")).resolves.toBeUndefined();
  });
  it("onVoicesChanged forwards the active Piper engine's voices and disposer stops delivery", async () => {
    installStorage();
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: fakeWebSpeech(false), piper });

    const seen: Voice[][] = [];
    const dispose = controller.onVoicesChanged((voices) => seen.push(voices));

    piper._emitsVoicesChanged();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]?.voiceUri).toBe("piper:en_US-amy");

    dispose();
    piper._emitsVoicesChanged();
    expect(seen).toHaveLength(1);
  });

  it("onVoicesChanged does not forward the inactive Web Speech engine's voices", async () => {
    installStorage();
    const ws = fakeWebSpeech(false); // Piper is active
    const controller = await createEngineController({ webSpeech: ws, piper: fakePiper() });

    const seen: Voice[][] = [];
    controller.onVoicesChanged((voices) => seen.push(voices));

    ws._emitsVoicesChanged();
    // Still Piper-active; Web Speech voices must NOT leak while inactive.
    expect(seen).toHaveLength(0);
  });

  it("onBoundary disposer stops further boundary delivery", async () => {
    installStorage();
    const controller = await createEngineController({
      webSpeech: fakeWebSpeech(false),
      piper: fakePiper(),
    });

    const events: BoundaryEvent[] = [];
    const dispose = controller.onBoundary((e) => events.push(e));

    controller.speak("first", { ...OPTS, voiceUri: "piper:en_US-amy" });
    expect(events).toHaveLength(1);

    dispose();
    controller.speak("second", { ...OPTS, voiceUri: "piper:en_US-amy" });
    expect(events).toHaveLength(1);
  });

  it("onEnd relays end events from the active engine only", async () => {
    installStorage();
    const ws = fakeWebSpeech(false); // active engine is Piper
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: ws, piper });

    let fired = 0;
    controller.onEnd(() => {
      fired++;
    });

    controller.speak("Hello", { ...OPTS, voiceUri: "piper:en_US-amy" });
    expect(piper.speaks).toHaveLength(1);
    expect(piper.speaks[0]?.text).toBe("Hello");

    // Inactive engine firing end must NOT advance the consumer's position.
    ws._emitEnd();
    expect(fired).toBe(0);

    piper._emitEnd();
    expect(fired).toBe(1);
  });

  it("onEnd disposer stops further end delivery", async () => {
    installStorage();
    const piper = fakePiper();
    const controller = await createEngineController({ webSpeech: fakeWebSpeech(false), piper });

    let fired = 0;
    const dispose = controller.onEnd(() => {
      fired++;
    });

    controller.speak("first", { ...OPTS, voiceUri: "piper:en_US-amy" });
    piper._emitEnd();
    expect(fired).toBe(1);

    dispose();
    controller.speak("second", { ...OPTS, voiceUri: "piper:en_US-amy" });
    piper._emitEnd();
    expect(fired).toBe(1);
  });

  it("hydrates with defaults when persisted settings are corrupt (invalid selection + voiceUri)", async () => {
    installStorage();
    store["tts:engine-controller"] = { engineSelection: "bogus", voiceUri: 42 };

    const controller = await createEngineController({
      webSpeech: fakeWebSpeech(true),
      piper: fakePiper(),
    });

    expect(controller.getSelection()).toBe("auto");
    expect(controller.getCurrentEngine()).toBe("web-speech");
  });

  it("hydrates with defaults when the persisted record is a non-object", async () => {
    installStorage();
    store["tts:engine-controller"] = "garbage";

    const controller = await createEngineController({
      webSpeech: fakeWebSpeech(true),
      piper: fakePiper(),
    });

    expect(controller.getSelection()).toBe("auto");
  });

  it("hydrates with defaults when storage.get rejects", async () => {
    installStorage({ getThrows: true });

    const controller = await createEngineController({
      webSpeech: fakeWebSpeech(true),
      piper: fakePiper(),
    });

    expect(controller.getSelection()).toBe("auto");
    expect(controller.getCurrentEngine()).toBe("web-speech");
  });

  it("exposes the selection type at the type layer (EngineSelection union)", () => {
    const sel: EngineSelection = "auto";
    const _: EngineSelection = sel;
    expect(_).toBe("auto");
  });
});
