import type { BoundaryEvent } from "$lib/features/tts/engine";

import { getVoiceModel } from "$lib/features/tts/voice-store";
import { getChrome, type MessageListener } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0006 — the Piper synthesis seam, run inside the offscreen document.
 *
 * The WASM Piper VITS build runs here; the controller-side adapter
 * (`piper-engine.ts`) orchestrates by sending `tts:piper:synthesize` runtime
 * messages and playing the returned audio buffer through the 0005 audio
 * channel. This module owns the seam: a {@link PiperSynth} interface backed
 * (for now) by a stub, and {@link startPiperSynthHost} which registers the
 * runtime message listener that reads the cached model from IndexedDB, calls
 * the synth, and returns the audio + boundaries as the message response.
 *
 * Node/Firefox-safe: with no `chrome.runtime.onMessage` the host is a no-op
 * returning a no-op disposer, so the module imports cleanly anywhere. The real
 * WASM integration (loading a maintained `piper-wasm` package or a compiled
 * Piper VITS build) is the documented follow-up — see the task-4 report. The
 * {@link PiperSynth} contract is fixed so the real build drops in here without
 * touching the adapter or the cache.
 */

/** Per-utterance synthesis options (mirror `SpeakOpts` minus `voiceUri`). */
export interface PiperSynthOptions {
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
}

/** Synthesis result returned to the controller: audio + char-offset boundaries. */
export interface PiperSynthResponse {
  /** Synthesized PCM/encoded audio, played via the offscreen `<audio>` pipeline. */
  readonly audio: ArrayBuffer;
  /** Char-offset boundaries the synthesizer emits, relayed to `onBoundary`. */
  readonly boundaries: BoundaryEvent[];
  /** Sample rate of `audio` (Hz). */
  readonly sampleRate: number;
}

/**
 * The WASM Piper synthesizer seam. Real implementations load a Piper VITS WASM
 * build and produce audio from `text` + the cached `model` Blob. The unit test
 * supplies a fake; {@link createPiperSynth} supplies the stub.
 */
export interface PiperSynth {
  synthesize(text: string, model: Blob, opts: PiperSynthOptions): Promise<PiperSynthResponse>;
}

/** The controller → offscreen synthesize message. */
export interface PiperSynthMessage {
  readonly type: "tts:piper:synthesize";
  readonly text: string;
  readonly voiceUri: string;
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
}

const PIPER_SYNTH_TYPE = "tts:piper:synthesize";

/** Narrows an untyped runtime message to a {@link PiperSynthMessage}. */
export function isPiperSynthMessage(message: unknown): message is PiperSynthMessage {
  if (!message || typeof message !== "object") return false;
  const m = message as {
    type?: unknown;
    text?: unknown;
    voiceUri?: unknown;
    rate?: unknown;
    pitch?: unknown;
    volume?: unknown;
  };
  return (
    m.type === PIPER_SYNTH_TYPE &&
    typeof m.text === "string" &&
    typeof m.voiceUri === "string" &&
    typeof m.rate === "number" &&
    typeof m.pitch === "number" &&
    typeof m.volume === "number"
  );
}

/**
 * Returns a STUB {@link PiperSynth} that rejects every synthesis until the real
 * WASM build is integrated (ticket 0006 follow-up). The contract is fixed; the
 * real loader swaps in here without touching callers.
 */
export function createPiperSynth(): PiperSynth {
  return {
    async synthesize(): Promise<PiperSynthResponse> {
      throw new Error("Piper WASM build not integrated (ticket 0006 follow-up).");
    },
  };
}

/**
 * Starts the offscreen Piper synthesis host: registers a runtime message
 * listener that handles `tts:piper:synthesize` by reading the cached model from
 * IndexedDB (the adapter already ensured it), synthesizing via `synth`, and
 * returning the {@link PiperSynthResponse} as the message response (MV3
 * resolves a returned promise into the `sendMessage` reply). Non-piper messages
 * are ignored (returned `undefined`) so the audio host and router keep working.
 *
 * No-op (returns a no-op disposer) when the runtime message bus is unavailable
 * (node, Firefox), so this is safe to call from the offscreen entry.
 */
export function startPiperSynthHost(synth: PiperSynth): () => void {
  const onMessage = getChrome()?.runtime?.onMessage;
  if (!onMessage) return () => {};

  const listener: MessageListener = (message: unknown): Promise<PiperSynthResponse> | undefined => {
    if (!isPiperSynthMessage(message)) return undefined;
    return runSynthesis(synth, message);
  };

  onMessage.addListener(listener);
  return () => onMessage.removeListener(listener);
}

async function runSynthesis(
  synth: PiperSynth,
  message: PiperSynthMessage,
): Promise<PiperSynthResponse> {
  const model = await getVoiceModel(message.voiceUri);
  if (!model) throw new Error(`No cached Piper model for voiceUri "${message.voiceUri}"`);
  return synth.synthesize(message.text, model, {
    rate: message.rate,
    pitch: message.pitch,
    volume: message.volume,
  });
}
