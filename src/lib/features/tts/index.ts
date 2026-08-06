/**
 * Public barrel for the TTS feature.
 *
 * Other features may depend on TTS only through this file. Deep imports into
 * the feature's internals are reserved for files inside the same feature.
 */

export type { BoundaryEvent, Engine, SpeakOpts, Voice } from "./engine.js";
export { createPiperEngine } from "./piper-engine.js";
export { createWebSpeechEngine } from "./web-speech-engine.js";
