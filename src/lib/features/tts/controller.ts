/**
 * Ticket 0007 — engine selection/fallback controller.
 *
 * Owns the hybrid TTS decision: Web Speech first, Piper when Web Speech reports
 * no voices. Exposes a `currentEngine` observable that the UI reads.
 */

import type { Engine, Voice } from "$lib/features/tts/engine";

import { createPiperEngine } from "$lib/features/tts/piper-engine";
import { createWebSpeechEngine } from "$lib/features/tts/web-speech-engine";

export type EngineKind = "web-speech" | "piper";

export interface EngineController {
  /** The active engine. */
  getEngine(): Engine;
  /** Which engine is currently selected. */
  getKind(): EngineKind;
  /** Available voices for the active engine. */
  getVoices(): Promise<Voice[]>;
  /** Select an engine kind explicitly. */
  select(kind: EngineKind): void;
  /** Subscribe to engine changes. Returns disposer. */
  onChange(listener: (kind: EngineKind) => void): () => void;
}

export interface EngineControllerOptions {
  /** Piper voice catalog; used only when Web Speech has no voices or Piper is selected. */
  piperVoices: Parameters<typeof createPiperEngine>[0]["voices"];
}

export function createEngineController(options: EngineControllerOptions): EngineController {
  const webSpeechEngine = createWebSpeechEngine();
  const piperEngine = createPiperEngine({ voices: options.piperVoices });

  let kind: EngineKind = webSpeechEngine.hasVoices() ? "web-speech" : "piper";
  const listeners = new Set<(kind: EngineKind) => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener(kind);
    }
  }

  return {
    getEngine(): Engine {
      return kind === "web-speech" ? webSpeechEngine : piperEngine;
    },
    getKind(): EngineKind {
      return kind;
    },
    async getVoices(): Promise<Voice[]> {
      return this.getEngine().getVoices();
    },
    select(kindValue: EngineKind): void {
      if (kindValue === kind) return;
      kind = kindValue;
      notify();
    },
    onChange(listener: (kind: EngineKind) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
