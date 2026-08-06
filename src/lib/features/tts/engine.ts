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
  getVoices(): Promise<Voice[]>;
  onVoicesChanged(cb: (voices: Voice[]) => void): () => void;
  onBoundary(cb: (e: BoundaryEvent) => void): () => void;
}
