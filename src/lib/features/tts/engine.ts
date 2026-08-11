/**
 * Ticket 0003 — TTS engine abstraction.
 *
 * The seam letting Web Speech (0004) and WASM Piper (0006) swap behind one
 * contract. This module is types only — no engine implementation lives here.
 * Consumers: 0007 engine-selection/fallback controller, 0015 voice/speed
 * settings.
 *
 * `getVoices()` is async (`Promise<Voice[]>`): voice lists load asynchronously
 * on both backends, so callers always `await`. `onBoundary` carries a char
 * offset within the uttered text; that offset is load-bearing for the
 * as-you-read highlighting in 0016.
 */

/** Per-utterance playback options. Units match the Web Speech API surface. */
export interface SpeakOpts {
  rate: number;
  pitch: number;
  volume: number;
  voiceUri: string;
}

/** A selectable synthesis voice. `voiceUri` is the stable identity. */
export interface Voice {
  name: string;
  lang: string;
  voiceUri: string;
  isLocal: boolean;
}

/**
 * A boundary reached during synthesis. `charIndex` is a char offset within the
 * `speak()` text; `charLength` covers the current word/phrase when known.
 */
export interface BoundaryEvent {
  charIndex: number;
  charLength?: number;
  text?: string;
}

/**
 * Engine contract implemented by the Web Speech and WASM Piper adapters.
 *
 * Every `on*` subscriber registration returns a disposer that removes the
 * callback; engines MUST NOT invoke a callback after its disposer runs.
 */
export interface Engine {
  speak(text: string, opts: SpeakOpts): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /** Whether the engine has a live, paused utterance that `resume()` can
   * continue. Consumers branch on this to resume-at-offset vs. re-speak from
   * the chunk top (bug 1): after `pause()` it is true until the utterance ends,
   * is cancelled, or the backend auto-stops it (Chrome drops `speechSynthesis`
   * after ~15s of silence). */
  isPaused(): boolean;
  getVoices(): Promise<Voice[]>;
  onVoicesChanged(cb: (voices: Voice[]) => void): () => void;
  /**
   * An utterance finished speaking. Engines fire this ONLY on natural
   * completion — a cancel/stop (e.g. `speechSynthesis.cancel()`) MUST NOT fire
   * it. Adapters suppress superseded/cancelled events with a generation token
   * (Piper's `currentToken`/`playingToken`, Web Speech's utterance token) so a
   * consumer can treat every `onEnd` as "advance to the next chunk" without
   * distinguishing cancel from completion (bug 2).
   */
  onEnd(cb: () => void): () => void;
}
