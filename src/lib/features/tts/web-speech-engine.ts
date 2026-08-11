import type { BoundaryEvent, Engine, SpeakOpts, Voice } from "$lib/features/tts/engine";

/**
 * Ticket 0004 — Web Speech adapter, the primary TTS path.
 *
 * Implements `Engine` over `window.speechSynthesis` + `SpeechSynthesisUtterance`.
 * `hasVoices()` is NOT part of `Engine`; ticket 0007 reads it to decide whether to
 * fall back to the WASM Piper adapter (ticket 0006) — Firefox Android's
 * `getVoices()` is observed to be empty, which is the reason the hybrid exists.
 *
 * All `window.speechSynthesis` / `SpeechSynthesisUtterance` access is gated so
 * importing this module in node (no DOM) does not crash.
 */

/** The shape the adapter needs from `SpeechSynthesisVoice`. */
interface SynthVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
}

/** The `speechSynthesis` surface the adapter uses. */
interface Synth {
  speak(utterance: unknown): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  /** True while a speak() utterance is paused (cleared on resume/end/cancel). */
  readonly paused: boolean;
  getVoices(): SynthVoice[];
  addEventListener(type: "voiceschanged", cb: (e: Event) => void): void;
  removeEventListener(type: "voiceschanged", cb: (e: Event) => void): void;
}

/** `SpeechSynthesisUtterance` constructor surface the adapter uses. */
type UtteranceCtor = new (text: string) => Utterance;

interface Utterance {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SynthVoice | undefined;
  addEventListener(type: "boundary" | "end", cb: (e: SpeechSynthesisEvent) => void): void;
}

/** Max wait (ms) for `voiceschanged` before `getVoices()` resolves with what it has. */
const VOICES_TIMEOUT_MS = 2000;

const globalRef = globalThis as unknown as {
  window?: {
    speechSynthesis?: Synth;
    SpeechSynthesisUtterance?: UtteranceCtor;
  };
};

function getSynth(): Synth | undefined {
  return globalRef.window?.speechSynthesis;
}

function getUtteranceCtor(): UtteranceCtor | undefined {
  return globalRef.window?.SpeechSynthesisUtterance;
}

function mapVoice(v: SynthVoice): Voice {
  return { name: v.name, lang: v.lang, voiceUri: v.voiceURI, isLocal: v.localService };
}

/**
 * Adapter over the Web Speech API. Created via {@link createWebSpeechEngine}.
 * Exposes {@link WebSpeechEngine.hasVoices} alongside the `Engine` contract.
 */
export interface WebSpeechEngine extends Engine {
  hasVoices(): boolean;
}

/**
 * Build a Web Speech adapter bound to `window.speechSynthesis`. Safe to import
 * in node — every method no-ops when the API is absent.
 */
export function createWebSpeechEngine(): WebSpeechEngine {
  const boundaryCbs = new Set<(e: BoundaryEvent) => void>();
  const endCbs = new Set<() => void>();
  return {
    speak(text: string, opts: SpeakOpts): void {
      const synth = getSynth();
      const Ctor = getUtteranceCtor();
      if (!synth || !Ctor) return;

      const utterance = new Ctor(text);
      utterance.rate = opts.rate;
      utterance.pitch = opts.pitch;
      utterance.volume = opts.volume;
      const match = synth.getVoices().find((v) => v.voiceURI === opts.voiceUri);
      if (match) utterance.voice = match;

      utterance.addEventListener("boundary", (e) => {
        const boundary: BoundaryEvent = {
          charIndex: e.charIndex,
          charLength: e.charLength,
          text: e.utterance.text,
        };
        for (const cb of boundaryCbs) cb(boundary);
      });
      utterance.addEventListener("end", () => {
        for (const cb of endCbs) cb();
      });

      synth.speak(utterance);
    },

    stop(): void {
      getSynth()?.cancel();
    },

    pause(): void {
      getSynth()?.pause();
    },

    resume(): void {
      getSynth()?.resume();
    },

    isPaused(): boolean {
      return getSynth()?.paused ?? false;
    },

    async getVoices(): Promise<Voice[]> {
      const synth = getSynth();
      if (!synth) return [];

      const current = synth.getVoices();
      if (current.length > 0) return current.map(mapVoice);

      // Empty (e.g. Firefox Android): wait for `voiceschanged` or a timeout.
      return new Promise<Voice[]>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          synth.removeEventListener("voiceschanged", onChanged);
          clearTimeout(timer);
          resolve(synth.getVoices().map(mapVoice));
        };
        const onChanged = (): void => finish();
        synth.addEventListener("voiceschanged", onChanged);
        const timer = setTimeout(finish, VOICES_TIMEOUT_MS);
      });
    },

    onVoicesChanged(cb: (voices: Voice[]) => void): () => void {
      const synth = getSynth();
      if (!synth) return () => {};
      const handler = (): void => cb(synth.getVoices().map(mapVoice));
      synth.addEventListener("voiceschanged", handler);
      return () => synth.removeEventListener("voiceschanged", handler);
    },

    onBoundary(cb: (e: BoundaryEvent) => void): () => void {
      boundaryCbs.add(cb);
      return () => {
        boundaryCbs.delete(cb);
      };
    },
    onEnd(cb: () => void): () => void {
      endCbs.add(cb);
      return () => {
        endCbs.delete(cb);
      };
    },

    hasVoices(): boolean {
      const synth = getSynth();
      return synth !== undefined && synth.getVoices().length > 0;
    },
  };
}
