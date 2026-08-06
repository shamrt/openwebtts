import type { BoundaryEvent, Engine, SpeakOpts, Voice } from "$lib/features/tts/engine";

import { describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0003 — Define the TTS engine abstraction interface.
 *
 * No real engine exists yet; this suite asserts the contract is observable:
 * a fake implementing `Engine` compiles against the interface, records calls,
 * resolves `getVoices()` to a `Voice[]`, and relays `onBoundary` char offsets
 * (load-bearing for 0016 as-you-read highlighting).
 */

/**
 * A minimal, in-memory fake used only to exercise the interface contract.
 * Not an adapter — tickets 0004/0006 ship the real engines.
 */
class FakeEngine implements Engine {
  spoken: { text: string; opts: SpeakOpts }[] = [];
  stopped = false;
  paused = false;
  resumed = false;
  voices: Voice[] = [];
  private voiceCbs = new Set<(voices: Voice[]) => void>();
  private boundaryCbs = new Set<(e: BoundaryEvent) => void>();

  speak(text: string, opts: SpeakOpts): void {
    this.spoken.push({ text, opts });
  }

  stop(): void {
    this.stopped = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.resumed = true;
  }

  async getVoices(): Promise<Voice[]> {
    return structuredClone(this.voices);
  }

  onVoicesChanged(cb: (voices: Voice[]) => void): () => void {
    this.voiceCbs.add(cb);
    return () => {
      this.voiceCbs.delete(cb);
    };
  }

  onBoundary(cb: (e: BoundaryEvent) => void): () => void {
    this.boundaryCbs.add(cb);
    return () => {
      this.boundaryCbs.delete(cb);
    };
  }

  /** Test-only emitter mimicking the engine firing a boundary event. */
  emitBoundary(e: BoundaryEvent): void {
    for (const cb of this.boundaryCbs) cb(e);
  }

  /** Test-only emitter mimicking the engine firing a voices-changed event. */
  emitVoicesChanged(): void {
    for (const cb of this.voiceCbs) cb(this.voices);
  }
}

describe("Engine interface (ticket 0003)", () => {
  it("a fake satisfies the Engine contract at compile time", () => {
    const fake = new FakeEngine();
    // Assignment to `Engine` is the structural compile-time check; if the fake
    // drops or renames a member this file no longer type-checks.
    const _e: Engine = fake;
    expect(_e).toBe(fake);
  });

  it("records speak() calls with the supplied text and options", () => {
    const fake = new FakeEngine();
    const opts: SpeakOpts = {
      rate: 1.1,
      pitch: 0.9,
      volume: 0.75,
      voiceUri: "urn:voice:en-US-Aria",
    };

    fake.speak("Hello world.", opts);
    fake.speak("Second sentence.", opts);

    expect(fake.spoken).toHaveLength(2);
    expect(fake.spoken[0]).toEqual({ text: "Hello world.", opts });
    expect(fake.spoken[1]?.text).toBe("Second sentence.");
  });

  it("stop/pause/resume mutate engine state as observable no-ops-returning-void", () => {
    const fake = new FakeEngine();

    expect(fake.stop()).toBeUndefined();
    expect(fake.pause()).toBeUndefined();
    expect(fake.resume()).toBeUndefined();
    expect({ stopped: fake.stopped, paused: fake.paused, resumed: fake.resumed }).toEqual({
      stopped: true,
      paused: true,
      resumed: true,
    });
  });

  it("getVoices() resolves to a Voice[] with the expected shape", async () => {
    const fake = new FakeEngine();
    fake.voices = [
      { name: "Aria", lang: "en-US", voiceUri: "urn:voice:aria", isLocal: true },
      { name: "Piper", lang: "en", voiceUri: "urn:voice:piper", isLocal: false },
    ];

    const result = await fake.getVoices();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    for (const v of result) {
      expect(typeof v.name).toBe("string");
      expect(typeof v.lang).toBe("string");
      expect(typeof v.voiceUri).toBe("string");
      expect(typeof v.isLocal).toBe("boolean");
    }
    expect(result[0]?.voiceUri).toBe("urn:voice:aria");
  });

  it("onBoundary relays the char offset to a registered callback", () => {
    const fake = new FakeEngine();
    const received: BoundaryEvent[] = [];
    const off = fake.onBoundary((e) => received.push(e));

    fake.emitBoundary({ charIndex: 6, charLength: 5, text: "world" });
    fake.emitBoundary({ charIndex: 0 });

    expect(received).toEqual([{ charIndex: 6, charLength: 5, text: "world" }, { charIndex: 0 }]);
    off();
    fake.emitBoundary({ charIndex: 12 });
    expect(received).toHaveLength(2);
  });

  it("onVoicesChanged relays the voice list and the disposer stops delivery", () => {
    const fake = new FakeEngine();
    fake.voices = [{ name: "Aria", lang: "en-US", voiceUri: "urn:voice:aria", isLocal: true }];
    const seen: Voice[][] = [];
    const off = fake.onVoicesChanged((voices) => seen.push(voices));

    fake.emitVoicesChanged();
    off();
    fake.emitVoicesChanged();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]?.voiceUri).toBe("urn:voice:aria");
  });
});
