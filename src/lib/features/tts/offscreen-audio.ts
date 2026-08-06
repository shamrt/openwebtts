import { isAudioChannelMessage } from "$lib/features/tts/audio-channel";
import { getChrome } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0005 — offscreen document audio host.
 *
 * Runs inside the Chromium offscreen document. Owns an `<audio>` element and
 * translates the typed {@link AudioChannelMessage} commands (sent by
 * `audio-channel.ts` over `chrome.runtime.sendMessage`) into real
 * `HTMLMediaElement` calls: load sets `src`, play/pause/stop drive the element.
 *
 * Node-safe: with no `document` (node test env) or no `chrome.runtime.onMessage`
 * (Firefox, where the offscreen path is not used), {@link startOffscreenAudio}
 * is a no-op that returns a no-op disposer, so the module can be imported
 * anywhere without crashing. The offscreen entry (`src/offscreen/offscreen.ts`)
 * calls {@link startOffscreenAudio} once on load.
 */

/** The slice of `HTMLAudioElement` the host actually drives. */
interface AudioElement {
  src: string;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

/** The slice of `document` the host needs to create the element. */
interface DocumentSurface {
  createElement(tag: "audio"): AudioElement;
  createElement(tag: string): AudioElement | null;
}

function getDocument(): DocumentSurface | undefined {
  const g = globalThis as Record<string, unknown>;
  const doc = g.document;
  return typeof doc === "object" && doc !== null ? (doc as DocumentSurface) : undefined;
}

/**
 * Starts the offscreen audio host: creates the `<audio>` element and registers
 * the runtime message listener that drives it. Returns a disposer that
 * removes the listener. No-op (returns a no-op disposer) when the DOM or the
 * runtime message bus is unavailable.
 */
export function startOffscreenAudio(): () => void {
  const doc = getDocument();
  const chrome = getChrome();
  const onMessage = chrome?.runtime?.onMessage;
  if (!doc || !onMessage) return () => {};

  const audio = doc.createElement("audio");

  const listener = (message: unknown): void => {
    if (!isAudioChannelMessage(message)) return;
    switch (message.type) {
      case "tts:audio:load":
        audio.src = message.src;
        break;
      case "tts:audio:play":
        void audio.play();
        break;
      case "tts:audio:pause":
        audio.pause();
        break;
      case "tts:audio:stop":
        audio.pause();
        audio.currentTime = 0;
        break;
    }
  };

  onMessage.addListener(listener);
  return () => {
    onMessage.removeListener(listener);
  };
}
