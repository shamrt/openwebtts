import type { BoundaryEvent, Engine, SpeakOpts, Voice } from "$lib/features/tts/engine";

import { audioChannel } from "$lib/features/tts/audio-channel";
import { ensureOffscreenDocument } from "$lib/features/tts/offscreen-lifecycle";
import { type PiperSynthMessage, type PiperSynthResponse } from "$lib/features/tts/piper-synth";
import { ensureVoiceModel } from "$lib/features/tts/voice-store";
import { getChrome } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0006 — WASM Piper adapter, the FALLBACK TTS path.
 *
 * Implements `Engine` for when the Web Speech adapter (0004) has no voices
 * (Firefox Android): ticket 0007 selects this adapter only when
 * `webSpeechEngine.hasVoices()` is false. Synthesis runs a Piper VITS WASM
 * build inside the offscreen document (0005); the controller-side adapter
 * orchestrates: on `speak` it ensures the selected voice model is cached in
 * IndexedDB (download ~30–60MB on first use, read on subsequent loads — NO
 * re-download), sends a `tts:piper:synthesize` runtime message to the offscreen
 * synthesis host, relays the returned char-offset boundaries, and plays the
 * returned audio buffer through the offscreen `<audio>` pipeline (audioChannel).
 *
 * `stop` / `pause` / `resume` delegate to the audio channel; `stop` also
 * supersedes any in-flight synthesis so a late buffer is not played.
 *
 * Node-safe to import: all `chrome.*` / IndexedDB / WASM / DOM access is gated.
 * With no message bus the pipeline degrades to a swallowed rejection, so the
 * module imports cleanly in the vitest (node) environment.
 */

/** A selectable Piper voice model in the catalog supplied to the adapter. */
export interface PiperVoiceModel {
  /** Stable identity; matches the `SpeakOpts.voiceUri` the caller selects. */
  readonly voiceUri: string;
  readonly name: string;
  readonly lang: string;
  /** Download URL for the ~30–60MB model, fetched once and cached in IndexedDB. */
  readonly url: string;
  /** Model size in bytes (for UI display / size gating). */
  readonly size: number;
}

/** Audio MIME of the synthesized buffer the offscreen host returns. */
const SYNTH_AUDIO_MIME = "audio/wav";

/**
 * Builds the WASM Piper adapter bound to a voice catalog. The catalog is the
 * single source of the available Piper models; `getVoices()` maps it to the
 * `Voice` contract (Piper models run on-device, so `isLocal` is always `true`).
 */
export function createPiperEngine(options: { voices: PiperVoiceModel[] }): Engine {
  const voices = options.voices;
  const boundaryCbs = new Set<(e: BoundaryEvent) => void>();
  const voiceCbs = new Set<(voices: Voice[]) => void>();

  // Monotonic utterance token: `stop` bumps it so a superseded synthesis never
  // reaches the audio channel.
  let currentToken = 0;

  function mapVoice(m: PiperVoiceModel): Voice {
    return { name: m.name, lang: m.lang, voiceUri: m.voiceUri, isLocal: true };
  }

  /** Turns a synthesized buffer into a playable `<audio>` source URL. */
  function audioToSrc(audio: ArrayBuffer): string {
    const g = globalThis as {
      URL?: { createObjectURL?: (b: Blob) => string };
      Buffer?: { from(data: Uint8Array): { toString(enc: string): string } };
      btoa?: (s: string) => string;
    };
    if (g.URL?.createObjectURL)
      return g.URL.createObjectURL(new Blob([audio], { type: SYNTH_AUDIO_MIME }));
    // Node fallback (offscreen path never reaches here, but keeps tests honest).
    const bytes = new Uint8Array(audio);
    const b64 = g.Buffer
      ? g.Buffer.from(bytes).toString("base64")
      : g.btoa?.(String.fromCharCode(...bytes));
    return `data:${SYNTH_AUDIO_MIME};base64,${b64}`;
  }

  async function pipeline(text: string, opts: SpeakOpts, token: number): Promise<void> {
    const model = voices.find((v) => v.voiceUri === opts.voiceUri);
    if (!model) return; // unknown voice — nothing to synthesize

    // 1. Ensure the model is cached (download on first use, read on subsequent).
    try {
      await ensureVoiceModel(opts.voiceUri, model.url);
    } catch {
      return; // no IndexedDB / download failed — swallowed, consistent w/ 0004
    }
    if (token !== currentToken) return;

    // 2. Ensure the offscreen host exists before messaging it.
    await ensureOffscreenDocument();
    if (token !== currentToken) return;

    // 3. Ask the offscreen synthesis host for audio + boundaries.
    const runtime = getChrome()?.runtime;
    if (!runtime?.sendMessage) return;
    const message: PiperSynthMessage = {
      type: "tts:piper:synthesize",
      text,
      voiceUri: opts.voiceUri,
      rate: opts.rate,
      pitch: opts.pitch,
      volume: opts.volume,
    };
    let result: PiperSynthResponse;
    try {
      result = (await runtime.sendMessage(message)) as PiperSynthResponse;
    } catch {
      return; // WASM not integrated / host rejected — swallowed
    }
    if (token !== currentToken) return;

    // 4. Relay char-offset boundaries (load-bearing for 0016 highlighting).
    // A throwing consumer callback must not abort playback.
    for (const b of result.boundaries) {
      for (const cb of boundaryCbs) {
        try {
          cb(b);
        } catch {
          // consumer callback bug — isolated, never surfaces or aborts play
        }
      }
    }

    // 5. Play the synthesized buffer through the offscreen `<audio>` pipeline.
    const src = audioToSrc(result.audio);
    await audioChannel.load(src);
    if (token !== currentToken) return;
    await audioChannel.play();
  }

  return {
    speak(text: string, opts: SpeakOpts): void {
      const token = ++currentToken;
      // Fire-and-forget: any rejection (model cache, synth message, audio
      // channel, audioToSrc) is swallowed so a discarded pipeline never
      // surfaces as an unhandled promise rejection.
      void pipeline(text, opts, token).catch(() => {});
    },

    stop(): void {
      currentToken += 1; // supersede any in-flight synthesis
      void audioChannel.stop();
    },

    pause(): void {
      void audioChannel.pause();
    },

    resume(): void {
      void audioChannel.play();
    },

    async getVoices(): Promise<Voice[]> {
      return voices.map(mapVoice);
    },

    onVoicesChanged(cb: (voices: Voice[]) => void): () => void {
      voiceCbs.add(cb);
      return () => {
        voiceCbs.delete(cb);
      };
    },

    onBoundary(cb: (e: BoundaryEvent) => void): () => void {
      boundaryCbs.add(cb);
      return () => {
        boundaryCbs.delete(cb);
      };
    },
  };
}
