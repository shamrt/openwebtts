import type { AudioChannelMessage } from "$lib/features/tts/audio-channel";

import { isAudioChannelMessage } from "$lib/features/tts/audio-channel";
import { ensureOffscreenDocument } from "$lib/features/tts/offscreen-lifecycle";
import { getChrome, type MessageListener } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0005 fix — background audio router.
 *
 * Chrome closes an offscreen document created with the AUDIO_PLAYBACK reason
 * ~30s after audio stops. A controller command arriving after that silence is
 * dropped: the offscreen host is gone, and the service worker's module-eval
 * `ensureOffscreenDocument` runs too late to rescue the in-flight message (it
 * is delivered to contexts that existed at send time).
 *
 * So the background routes every audio command: on receiving a controller
 * {@link AudioChannelMessage} it awaits {@link ensureOffscreenDocument}
 * (idempotent; the creation race is already swallowed) and then forwards an
 * internal {@link OffscreenAudioCommand} to the offscreen document. The host
 * accepts ONLY internal commands, so a controller's direct public broadcast
 * is ignored by the host and delivered solely through the background —
 * guaranteeing the document exists before the command is handled, with no
 * double delivery.
 *
 * Node/Firefox-safe: no `chrome.runtime` message bus → `startAudioRouter` is a
 * no-op and `routeAudioMessage` resolves without sending.
 */

/** Internal command (background → offscreen). The host accepts only these. */
export type OffscreenAudioCommand =
  | { readonly type: "tts:audio:internal:load"; readonly src: string }
  | { readonly type: "tts:audio:internal:play" }
  | { readonly type: "tts:audio:internal:pause" }
  | { readonly type: "tts:audio:internal:stop" };

const INTERNAL_COMMAND_TYPES = new Set<OffscreenAudioCommand["type"]>([
  "tts:audio:internal:load",
  "tts:audio:internal:play",
  "tts:audio:internal:pause",
  "tts:audio:internal:stop",
]);

/** Narrows an untyped runtime message to an internal {@link OffscreenAudioCommand}. */
export function isOffscreenAudioCommand(message: unknown): message is OffscreenAudioCommand {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  if (!INTERNAL_COMMAND_TYPES.has(type as OffscreenAudioCommand["type"])) return false;
  if (type === "tts:audio:internal:load") {
    return typeof (message as { src?: unknown }).src === "string";
  }
  return true;
}

function toInternal(message: AudioChannelMessage): OffscreenAudioCommand {
  switch (message.type) {
    case "tts:audio:load":
      return { type: "tts:audio:internal:load", src: message.src };
    case "tts:audio:play":
      return { type: "tts:audio:internal:play" };
    case "tts:audio:pause":
      return { type: "tts:audio:internal:pause" };
    case "tts:audio:stop":
      return { type: "tts:audio:internal:stop" };
  }
}

/**
 * Routes one runtime message: if it is a controller audio command, ensures the
 * offscreen document exists, then forwards the internal command to the host.
 * Never rejects — `ensureOffscreenDocument` swallows creation races, and a
 * missing `chrome.runtime` (node/Firefox) makes this a no-op.
 */
export async function routeAudioMessage(message: unknown): Promise<void> {
  if (!isAudioChannelMessage(message)) return;
  await ensureOffscreenDocument();
  const runtime = getChrome()?.runtime;
  if (!runtime?.sendMessage) return;
  await runtime.sendMessage(toInternal(message));
}

/**
 * Registers the background audio router on `chrome.runtime.onMessage`. Returns
 * a disposer. No-op (returns a no-op disposer) when the runtime message bus is
 * unavailable, so it is safe to call in node and on Firefox.
 */
export function startAudioRouter(): () => void {
  const onMessage = getChrome()?.runtime?.onMessage;
  if (!onMessage) return () => {};
  const listener: MessageListener = (message) => {
    // Do NOT return a promise for messages this router ignores: an async
    // onMessage listener whose promise resolves to undefined still sends
    // `null` as the response and, with multiple listeners, the first
    // responder wins — which would clobber a sibling host's real response
    // (e.g. the Piper synth host's PiperSynthResponse). Return undefined
    // synchronously for non-audio messages, matching the sibling hosts.
    if (!isAudioChannelMessage(message)) return undefined;
    return routeAudioMessage(message);
  };
  onMessage.addListener(listener);
  return () => onMessage.removeListener(listener);
}
