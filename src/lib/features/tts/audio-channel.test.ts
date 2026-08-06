import { audioChannel } from "$lib/features/tts/audio-channel";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0005 — controller-facing audio channel.
 *
 * The channel is the API ticket 0006 (Piper) / 0007 (fallback controller) call
 * to drive `<audio>` playback hosted in the offscreen document. It only sends
 * typed messages over `chrome.runtime.sendMessage`; the offscreen document
 * owns the element. These tests assert the typed message shape reaches the
 * message bus (and that the channel is a no-op with no `chrome` global, so it
 * can be imported in node without crashing).
 */

interface SentMessage {
  message: unknown;
}

const sent: SentMessage[] = [];

function installChrome(): void {
  const g = globalThis as Record<string, unknown>;
  g.chrome = {
    runtime: {
      sendMessage: (m: unknown) => {
        sent.push({ message: m });
        return Promise.resolve(undefined);
      },
    },
  };
}

function clearChrome(): void {
  delete (globalThis as Record<string, unknown>).chrome;
}

afterEach(() => {
  sent.length = 0;
  clearChrome();
});

describe("audio channel (ticket 0005)", () => {
  it("load sends a typed tts:audio:load message with the source", async () => {
    installChrome();
    await audioChannel.load("blob:https://openwebtts/0000-silent");
    expect(sent).toEqual([
      { message: { type: "tts:audio:load", src: "blob:https://openwebtts/0000-silent" } },
    ]);
  });

  it("play/pause/stop each send their typed command", async () => {
    installChrome();
    await audioChannel.play();
    await audioChannel.pause();
    await audioChannel.stop();
    expect(sent).toEqual([
      { message: { type: "tts:audio:play" } },
      { message: { type: "tts:audio:pause" } },
      { message: { type: "tts:audio:stop" } },
    ]);
  });

  it("is a no-op (does not throw) when chrome.runtime is absent", async () => {
    clearChrome();
    await expect(audioChannel.play()).resolves.toBeUndefined();
    await expect(audioChannel.load("x")).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });
});
