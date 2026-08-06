import { startOffscreenAudio } from "$lib/features/tts/offscreen-audio";

/**
 * Ticket 0005 — offscreen document entry.
 *
 * This module is loaded by the offscreen document (`pages/offscreen.html`).
 * It boots the audio host that owns the `<audio>` element and listens for the
 * controller's runtime messages. Ticket 0006 will load the WASM Piper engine
 * here and feed synthesized audio buffers through this same pipeline.
 */
startOffscreenAudio();
