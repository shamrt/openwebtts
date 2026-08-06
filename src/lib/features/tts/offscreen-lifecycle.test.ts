import { ensureOffscreenDocument } from "$lib/features/tts/offscreen-lifecycle";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0005 — Chromium offscreen document lifecycle.
 *
 * The background service worker creates and keeps the offscreen document
 * alive via `chrome.offscreen.createDocument`. Firefox has no
 * `chrome.offscreen`; node tests have no `chrome` at all. Both must be no-ops.
 * These tests assert the real lifecycle behavior against a fake
 * `chrome.offscreen`.
 */

interface OffscreenState {
  existing: boolean;
  createCalls: number;
  lastCreateOpts: { url: string; reasons: string[]; justification: string } | undefined;
}

let state: OffscreenState;
let hasDocumentCalls: number;

interface Saved {
  chrome?: unknown;
}
const saved: Saved = {};

function installChrome(existing: boolean): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  state = { existing, createCalls: 0, lastCreateOpts: undefined };
  hasDocumentCalls = 0;
  g.chrome = {
    offscreen: {
      hasDocument: async () => {
        hasDocumentCalls += 1;
        return state.existing;
      },
      createDocument: async (opts: { url: string; reasons: string[]; justification: string }) => {
        state.createCalls += 1;
        state.lastCreateOpts = opts;
        state.existing = true;
      },
    },
  };
}

function installChromeWithoutHasDocument(): void {
  const g = globalThis as Record<string, unknown>;
  saved.chrome = g.chrome;
  state = { existing: false, createCalls: 0, lastCreateOpts: undefined };
  g.chrome = {
    offscreen: {
      createDocument: async (opts: { url: string; reasons: string[]; justification: string }) => {
        state.createCalls += 1;
        state.lastCreateOpts = opts;
      },
    },
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if ("chrome" in saved) g.chrome = saved.chrome;
  else delete g.chrome;
});

describe("offscreen lifecycle (ticket 0005)", () => {
  it("creates the offscreen document when none exists", async () => {
    installChrome(false);
    await ensureOffscreenDocument();

    expect(hasDocumentCalls).toBe(1);
    expect(state.createCalls).toBe(1);
    expect(state.lastCreateOpts).toEqual({
      url: "pages/offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: expect.stringContaining("audio"),
    });
  });

  it("does not recreate when the document already exists", async () => {
    installChrome(true);
    await ensureOffscreenDocument();

    expect(hasDocumentCalls).toBe(1);
    expect(state.createCalls).toBe(0);
  });

  it("falls back to createDocument when hasDocument is unavailable", async () => {
    installChromeWithoutHasDocument();
    await ensureOffscreenDocument();

    expect(state.createCalls).toBe(1);
    expect(state.lastCreateOpts?.url).toBe("pages/offscreen.html");
  });

  it("swallows a createDocument rejection (already exists race)", async () => {
    const g = globalThis as Record<string, unknown>;
    saved.chrome = g.chrome;
    g.chrome = {
      offscreen: {
        hasDocument: async () => false,
        createDocument: async () => {
          throw new Error("Extension has already created an offscreen document");
        },
      },
    };
    await expect(ensureOffscreenDocument()).resolves.toBeUndefined();
  });

  it("is a no-op when chrome.offscreen is absent (Firefox / node)", async () => {
    const g = globalThis as Record<string, unknown>;
    saved.chrome = g.chrome;
    g.chrome = { runtime: {} };
    await expect(ensureOffscreenDocument()).resolves.toBeUndefined();

    delete g.chrome;
    await expect(ensureOffscreenDocument()).resolves.toBeUndefined();
  });
});
