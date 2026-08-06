import type { ChromeSurface } from "$lib/shared/chrome-runtime";

import { getChrome } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0005 — controller-facing audio channel.
 *
 * The API ticket 0006 (WASM Piper) and 0007 (fallback controller) call to
 * drive `<audio>` playback hosted in the offscreen document. The channel
 * owns the (minimal, typed) message protocol and sends each command over
 * `chrome.runtime.sendMessage`; the offscreen document owns the element.
 *
 * Node-safe: `getChrome` returns `undefined` without the `chrome` global, in
 * which case every command resolves as a no-op so the module can be imported
 * in the vitest (node) environment without crashing.
 */

/** The wire protocol between the controller and the offscreen audio host. */
export type AudioChannelMessage =
  | { readonly type: "tts:audio:load"; readonly src: string }
  | { readonly type: "tts:audio:play" }
  | { readonly type: "tts:audio:pause" }
  | { readonly type: "tts:audio:stop" };

const AUDIO_MESSAGE_TYPES = new Set<AudioChannelMessage["type"]>([
  "tts:audio:load",
  "tts:audio:play",
  "tts:audio:pause",
  "tts:audio:stop",
]);

/** Narrows an untyped runtime message to a {@link AudioChannelMessage}. */
export function isAudioChannelMessage(message: unknown): message is AudioChannelMessage {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  if (!AUDIO_MESSAGE_TYPES.has(type as AudioChannelMessage["type"])) return false;
  if (type === "tts:audio:load") {
    return typeof (message as { src?: unknown }).src === "string";
  }
  return true;
}

async function send(message: AudioChannelMessage): Promise<void> {
  const c: ChromeSurface | undefined = getChrome();
  if (!c?.runtime?.sendMessage) return;
  await c.runtime.sendMessage(message);
}

/** Controller-facing audio channel: play/pause/stop and load a source URL. */
export const audioChannel = {
  /** Load a source URL (Blob URL / data URL) into the offscreen `<audio>`. */
  load(src: string): Promise<void> {
    return send({ type: "tts:audio:load", src });
  },
  /** Start playback of the loaded source. */
  play(): Promise<void> {
    return send({ type: "tts:audio:play" });
  },
  /** Pause playback without resetting the position. */
  pause(): Promise<void> {
    return send({ type: "tts:audio:pause" });
  },
  /** Stop playback and reset the position to the start. */
  stop(): Promise<void> {
    return send({ type: "tts:audio:stop" });
  },
};
