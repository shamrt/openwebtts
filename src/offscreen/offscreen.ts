import { startOffscreenAudio } from "$lib/features/tts/offscreen-audio";
import { createPiperSynth, startPiperSynthHost } from "$lib/features/tts/piper-synth";

/**
 * Ticket 0005 / 0006 — offscreen document entry.
 *
 * Loaded by the offscreen document (`pages/offscreen.html`). It boots the
 * audio host that owns the `<audio>` element and listens for the controller's
 * audio runtime messages, and the Piper synthesis host that runs the WASM
 * VITS build and answers `tts:piper:synthesize` messages with audio buffers +
 * boundaries. `createPiperSynth()` is a stub until the real WASM build is
 * integrated (ticket 0006 follow-up); the contract is fixed so the real
 * loader drops in without touching the adapter or the cache.
 */
startOffscreenAudio();
startPiperSynthHost(createPiperSynth());
