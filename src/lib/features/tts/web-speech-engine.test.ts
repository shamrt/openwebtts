import type { BoundaryEvent, SpeakOpts, Voice } from "$lib/features/tts/engine";

import { createWebSpeechEngine } from "$lib/features/tts/web-speech-engine";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0004 — Web Speech adapter over `window.speechSynthesis`.
 *
 * Node has no DOM; these tests install a fake `speechSynthesis` and
 * `SpeechSynthesisUtterance` on `globalThis` and assert the adapter's real
 * behavior (voice mapping, async wait, boundary forwarding, disposer
 * semantics) — not just that mocks were called.
 */

/** Shape the adapter maps from `SpeechSynthesisVoice`. */
interface FakeVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

/** Minimal `SpeechSynthesisUtterance` stand-in: stores opts + listeners. */
class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: FakeVoice | undefined;
  private handlers = new Map<string, Set<(e: unknown) => void>>();

  constructor(text: string) {
    this.text = text;
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (e: unknown) => void): void {
    this.handlers.get(type)?.delete(cb);
  }

  /** Test-only: fire a named utterance event at all subscribers. */
  emit(type: string, e: unknown): void {
    for (const cb of this.handlers.get(type) ?? []) cb(e);
  }
}

/** Minimal `speechSynthesis` stand-in: records calls + emits `voiceschanged`. */
class FakeSynth {
  voices: FakeVoice[] = [];
  spoken: FakeUtterance[] = [];
  cancelled = false;
  paused = false;
  resumed = false;
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  speak(u: FakeUtterance): void {
    this.spoken.push(u);
  }

  cancel(): void {
    this.cancelled = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.resumed = true;
  }

  getVoices(): FakeVoice[] {
    return this.voices;
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  /** Test-only: fire `voiceschanged`, mirroring the real event name. */
  emitVoicesChanged(): void {
    for (const cb of this.listeners.get("voiceschanged") ?? []) cb({});
  }
}

const VOICES: FakeVoice[] = [
  { name: "Alex", lang: "en-US", voiceURI: "alex.uri", localService: true, default: true },
  {
    name: "Google US English",
    lang: "en-US",
    voiceURI: "google-us.uri",
    localService: false,
    default: false,
  },
];

interface Globals {
  window?: unknown;
  speechSynthesis?: unknown;
  SpeechSynthesisUtterance?: unknown;
}

const saved: Globals = {};
let synth: FakeSynth;

function install(s: FakeSynth): void {
  const g = globalThis as Record<string, unknown>;
  saved.window = g.window;
  saved.speechSynthesis = g.speechSynthesis;
  saved.SpeechSynthesisUtterance = g.SpeechSynthesisUtterance;
  g.window = g; // adapter gates on `typeof window !== "undefined"`
  g.speechSynthesis = s;
  g.SpeechSynthesisUtterance = FakeUtterance;
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if ("window" in saved) g.window = saved.window;
  else delete g.window;
  if ("speechSynthesis" in saved) g.speechSynthesis = saved.speechSynthesis;
  else delete g.speechSynthesis;
  if ("SpeechSynthesisUtterance" in saved)
    g.SpeechSynthesisUtterance = saved.SpeechSynthesisUtterance;
  else delete g.SpeechSynthesisUtterance;
});

describe("Web Speech adapter (ticket 0004)", () => {
  it("getVoices resolves immediately when voices are already present", async () => {
    synth = new FakeSynth();
    synth.voices = VOICES;
    install(synth);
    const engine = createWebSpeechEngine();

    const voices = await engine.getVoices();

    expect(voices).toEqual<Voice[]>([
      { name: "Alex", lang: "en-US", voiceUri: "alex.uri", isLocal: true },
      { name: "Google US English", lang: "en-US", voiceUri: "google-us.uri", isLocal: false },
    ]);
  });

  it("getVoices waits for voiceschanged before resolving when the list is empty", async () => {
    synth = new FakeSynth();
    install(synth);
    const engine = createWebSpeechEngine();

    let resolved = false;
    const p = engine.getVoices().then((v) => {
      resolved = true;
      return v;
    });

    // Yield once: the empty-voice path must NOT resolve eagerly.
    await Promise.resolve();
    expect(resolved).toBe(false);

    synth.voices = VOICES;
    synth.emitVoicesChanged();

    const voices = await p;
    expect(resolved).toBe(true);
    expect(voices).toHaveLength(2);
    expect(voices[0]!.voiceUri).toBe("alex.uri");
  });

  it("hasVoices reports false then true after voices load", async () => {
    synth = new FakeSynth();
    install(synth);
    const engine = createWebSpeechEngine();

    expect(engine.hasVoices()).toBe(false);

    synth.voices = VOICES;
    await engine.getVoices();

    expect(engine.hasVoices()).toBe(true);
  });

  it("speak applies opts and selects the voice by voiceUri", () => {
    synth = new FakeSynth();
    synth.voices = VOICES;
    install(synth);
    const engine = createWebSpeechEngine();

    const opts: SpeakOpts = { rate: 1.5, pitch: 0.75, volume: 0.9, voiceUri: "google-us.uri" };
    engine.speak("Hello world", opts);

    expect(synth.spoken).toHaveLength(1);
    const u = synth.spoken[0]!;
    expect(u.text).toBe("Hello world");
    expect(u.rate).toBe(1.5);
    expect(u.pitch).toBe(0.75);
    expect(u.volume).toBe(0.9);
    expect(u.voice?.voiceURI).toBe("google-us.uri");
  });

  it("forwards utterance boundary events to onBoundary with the char offset", () => {
    synth = new FakeSynth();
    synth.voices = VOICES;
    install(synth);
    const engine = createWebSpeechEngine();

    const events: BoundaryEvent[] = [];
    engine.onBoundary((e) => events.push(e));

    engine.speak("Hello world", { rate: 1, pitch: 1, volume: 1, voiceUri: "alex.uri" });
    const u = synth.spoken[0]!;
    u.emit("boundary", { charIndex: 6, charLength: 5, utterance: { text: "Hello world" } });

    expect(events).toEqual<BoundaryEvent[]>([{ charIndex: 6, charLength: 5, text: "Hello world" }]);
  });

  it("onBoundary disposer stops further boundary delivery", () => {
    synth = new FakeSynth();
    synth.voices = VOICES;
    install(synth);
    const engine = createWebSpeechEngine();

    const events: BoundaryEvent[] = [];
    const dispose = engine.onBoundary((e) => events.push(e));
    dispose();

    engine.speak("Hi", { rate: 1, pitch: 1, volume: 1, voiceUri: "alex.uri" });
    synth.spoken[0]!.emit("boundary", { charIndex: 0, utterance: { text: "Hi" } });

    expect(events).toHaveLength(0);
  });

  it("onVoicesChanged fires after voiceschanged and disposer stops delivery", () => {
    synth = new FakeSynth();
    synth.voices = VOICES;
    install(synth);
    const engine = createWebSpeechEngine();

    const seen: Voice[][] = [];
    const dispose = engine.onVoicesChanged((v) => seen.push(v));

    synth.voices = [VOICES[0]!];
    synth.emitVoicesChanged();
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]!.voiceUri).toBe("alex.uri");

    dispose();
    synth.voices = VOICES;
    synth.emitVoicesChanged();
    expect(seen).toHaveLength(1);
  });

  it("stop/pause/resume delegate to speechSynthesis", () => {
    synth = new FakeSynth();
    synth.voices = VOICES;
    install(synth);
    const engine = createWebSpeechEngine();

    engine.stop();
    engine.pause();
    engine.resume();

    expect(synth.cancelled).toBe(true);
    expect(synth.paused).toBe(true);
    expect(synth.resumed).toBe(true);
  });

  it("imports and operates safely with no speechSynthesis present", async () => {
    const g = globalThis as Record<string, unknown>;
    delete g.window;
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
    const engine = createWebSpeechEngine();

    expect(engine.hasVoices()).toBe(false);
    await expect(engine.getVoices()).resolves.toEqual([]);
    expect(() =>
      engine.speak("noop", { rate: 1, pitch: 1, volume: 1, voiceUri: "x" }),
    ).not.toThrow();
    expect(() => engine.stop()).not.toThrow();
  });
});
