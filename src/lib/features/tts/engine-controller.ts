import type { BoundaryEvent, Engine, SpeakOpts, Voice } from "$lib/features/tts/engine";
import type { WebSpeechEngine } from "$lib/features/tts/web-speech-engine";

import { getChrome } from "$lib/shared/chrome-runtime";

/**
 * Ticket 0007 — engine selection / fallback controller.
 *
 * Owns the hybrid TTS decision: Web Speech first, Piper when Web Speech has no
 * voices (Firefox Android). Sits between the two engines (0004 / 0006) and the
 * UI (0013) + settings panel (0015): it exposes the `Engine` contract (so it is
 * a drop-in playback surface) plus a `currentEngine` observable the UI reads to
 * label the active backend, and a persisted, overridable `EngineSelection`.
 *
 * Resolution rule:
 * - `piper`     → always Piper.
 * - `web-speech`→ always Web Speech.
 * - `auto`      → Web Speech when `webSpeech.hasVoices()`, else Piper.
 *
 * In `auto`, the Web Speech `voiceschanged` event can populate voices after
 * startup; the controller re-resolves and flips `currentEngine` live.
 *
 * Node-safe: persistence goes through `getChrome().storage`, which is
 * `undefined` without the `chrome` global — hydration then falls back to
 * defaults and `setSelection` resolves without persisting, so the module
 * imports and runs cleanly in the vitest (node) environment.
 */

/** The engine actually driving playback after the hybrid decision. */
export type ResolvedEngine = "web-speech" | "piper";

/** User-selectable mode. `auto` = Web Speech first, Piper on empty voices. */
export type EngineSelection = "auto" | ResolvedEngine;

/** Persisted controller state (read/written by the 0015 settings panel). */
export interface EngineControllerSettings {
  engineSelection: EngineSelection;
  voiceUri: string | null;
}

/** Storage key for the persisted controller settings. */
const STORAGE_KEY = "tts:engine-controller";

const DEFAULT_SETTINGS: EngineControllerSettings = {
  engineSelection: "auto",
  voiceUri: null,
};

/**
 * The controller's public surface: a drop-in {@link Engine} plus the selection
 * + `currentEngine` observables the UI and settings panel read.
 */
export interface EngineController extends Engine {
  /** The engine currently driving playback (the resolved hybrid decision). */
  getCurrentEngine(): ResolvedEngine;
  /** Subscribe to resolved-engine changes. Returns a disposer. */
  onCurrentEngine(cb: (engine: ResolvedEngine) => void): () => void;
  /** The user's selection (`auto` by default). */
  getSelection(): EngineSelection;
  /** Override the selection; persisted to storage and re-resolved. */
  setSelection(selection: EngineSelection): Promise<void>;
}

/** Applies the resolution rule to a selection given the Web Speech voice state. */
function resolveEngine(selection: EngineSelection, webSpeech: WebSpeechEngine): ResolvedEngine {
  if (selection === "piper") return "piper";
  if (selection === "web-speech") return "web-speech";
  return webSpeech.hasVoices() ? "web-speech" : "piper";
}

/** Loads persisted settings from `chrome.storage.local`, or defaults on miss. */
async function loadSettings(): Promise<EngineControllerSettings> {
  const storage = getChrome()?.storage;
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const record = (await storage.get(STORAGE_KEY)) as
      | Partial<EngineControllerSettings>
      | undefined;
    const loaded = record?.[STORAGE_KEY];
    if (!loaded || typeof loaded !== "object") return { ...DEFAULT_SETTINGS };
    return {
      engineSelection:
        loaded.engineSelection === "piper" ||
        loaded.engineSelection === "web-speech" ||
        loaded.engineSelection === "auto"
          ? loaded.engineSelection
          : DEFAULT_SETTINGS.engineSelection,
      voiceUri:
        typeof loaded.voiceUri === "string" || loaded.voiceUri === null
          ? (loaded.voiceUri as string | null)
          : DEFAULT_SETTINGS.voiceUri,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persists settings to `chrome.storage.local`; swallowed when unavailable. */
async function saveSettings(settings: EngineControllerSettings): Promise<void> {
  const storage = getChrome()?.storage;
  if (!storage) return;
  try {
    await storage.set({ [STORAGE_KEY]: settings });
  } catch {
    // No storage / write rejected — in-memory selection still applies.
  }
}

/**
 * Build the fallback controller over the two engines. Hydrates the persisted
 * selection from storage before resolving, so `currentEngine` is correct on
 * return.
 */
export async function createEngineController(options: {
  webSpeech: WebSpeechEngine;
  piper: Engine;
}): Promise<EngineController> {
  const engines: Record<ResolvedEngine, Engine> = {
    "web-speech": options.webSpeech,
    piper: options.piper,
  };

  const settings = await loadSettings();
  let selection: EngineSelection = settings.engineSelection;
  let current: ResolvedEngine = resolveEngine(selection, options.webSpeech);

  const currentCbs = new Set<(engine: ResolvedEngine) => void>();
  const voiceCbs = new Set<(voices: Voice[]) => void>();
  const boundaryCbs = new Set<(e: BoundaryEvent) => void>();

  function notifyCurrent(): void {
    for (const cb of currentCbs) cb(current);
  }

  /** Re-resolve from the current selection + Web Speech voice state. */
  function reresolve(): void {
    const next = resolveEngine(selection, options.webSpeech);
    if (next !== current) {
      current = next;
      notifyCurrent();
    }
  }

  // Web Speech voices can populate after startup (Firefox Android): re-resolve
  // and, when it becomes the active engine, forward its voice list.
  options.webSpeech.onVoicesChanged((voices) => {
    reresolve();
    if (current === "web-speech") for (const cb of voiceCbs) cb(voices);
  });
  // Piper's catalog is static; forward only while it is the active engine.
  options.piper.onVoicesChanged((voices) => {
    reresolve();
    if (current === "piper") for (const cb of voiceCbs) cb(voices);
  });

  // Boundaries relay only from the engine currently driving playback — a
  // boundary from the inactive engine would desync the 0016 highlighting.
  options.webSpeech.onBoundary((e) => {
    if (current === "web-speech") for (const cb of boundaryCbs) cb(e);
  });
  options.piper.onBoundary((e) => {
    if (current === "piper") for (const cb of boundaryCbs) cb(e);
  });

  return {
    speak(text: string, opts: SpeakOpts): void {
      engines[current].speak(text, opts);
    },
    stop(): void {
      engines[current].stop();
    },
    pause(): void {
      engines[current].pause();
    },
    resume(): void {
      engines[current].resume();
    },
    async getVoices(): Promise<Voice[]> {
      return engines[current].getVoices();
    },
    onVoicesChanged(cb: (voices: Voice[]) => void): () => void {
      voiceCbs.add(cb);
      return () => voiceCbs.delete(cb);
    },
    onBoundary(cb: (e: BoundaryEvent) => void): () => void {
      boundaryCbs.add(cb);
      return () => boundaryCbs.delete(cb);
    },
    getCurrentEngine(): ResolvedEngine {
      return current;
    },
    onCurrentEngine(cb: (engine: ResolvedEngine) => void): () => void {
      currentCbs.add(cb);
      return () => currentCbs.delete(cb);
    },
    getSelection(): EngineSelection {
      return selection;
    },
    async setSelection(next: EngineSelection): Promise<void> {
      selection = next;
      settings.engineSelection = next;
      await saveSettings(settings);
      reresolve();
    },
  };
}
