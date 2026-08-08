/**
 * Ticket 0007 — tests for the engine selection/fallback controller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEngineController } from "./controller.js";

describe("createEngineController", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      speechSynthesis: undefined,
      SpeechSynthesisUtterance: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to piper when web speech is absent", () => {
    const controller = createEngineController({ piperVoices: [] });
    expect(controller.getKind()).toBe("piper");
  });

  it("selects web-speech when speech synthesis has voices", () => {
    vi.stubGlobal("window", {
      speechSynthesis: {
        getVoices: () => [
          { name: "Alex", lang: "en-US", voiceURI: "uri://alex", localService: true },
        ],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
      SpeechSynthesisUtterance: class {
        text = "";
        rate = 1;
        pitch = 1;
        volume = 1;
        voice = undefined;
        addEventListener = vi.fn();
      },
    });

    const controller = createEngineController({ piperVoices: [] });
    expect(controller.getKind()).toBe("web-speech");
  });

  it("emits change events on explicit selection", () => {
    const controller = createEngineController({ piperVoices: [] });
    const changes: string[] = [];
    const dispose = controller.onChange((kind) => changes.push(kind));

    controller.select("web-speech");
    controller.select("web-speech");
    controller.select("piper");

    expect(changes).toEqual(["web-speech", "piper"]);
    dispose();
  });
});
