/**
 * Ticket 0013 — content-script overlay state + wiring.
 *
 * Coordinates extraction, the TTS controller, position tracking, settings,
 * and the Svelte overlay UI mounted in the Shadow DOM.
 */

import type { ArticleChunk } from "$lib/features/extraction/html-extractor.js";
import type { ReaderSettings, SettingsStore } from "$lib/features/settings/settings.js";
import type { EngineController } from "$lib/features/tts/controller.js";
import type { Engine, SpeakOpts } from "$lib/features/tts/engine.js";

import { extractArticle } from "$lib/features/extraction/html-extractor.js";
import {
  createHighlighter,
  toHighlightUnit,
  toSentenceHighlightUnit,
} from "$lib/features/reading/highlighter.js";
import {
  createPositionStore,
  createChromePositionStorage,
} from "$lib/features/reading/position.js";
import { DEFAULT_SETTINGS } from "$lib/features/settings/settings.js";
import { createEngineController } from "$lib/features/tts/controller.js";

export type OverlayState = { status: "idle" } | { status: "playing" } | { status: "paused" };

export interface OverlayStore {
  readonly state: OverlayState;
  readonly expanded: boolean;
  readonly currentChunk: ArticleChunk | null;
  readonly positionPercent: number;
  readonly engineKind: "web-speech" | "piper";
  play(): void;
  pause(): void;
  stop(): void;
  toggleExpanded(): void;
  close(): void;
  setEngine(kind: "web-speech" | "piper"): void;
  setHighlightMode(mode: ReaderSettings["highlightMode"]): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  onStateChange(listener: (state: OverlayState) => void): () => void;
  onChunkChange(listener: (chunk: ArticleChunk | null) => void): () => void;
  onExpandedChange(listener: (expanded: boolean) => void): () => void;
  /** DEV test seam: drive the highlighter as a boundary event would. */
  testDriveHighlight(chunkIndex: number, charOffset: number): void;
  /** DEV test seam: clear the active highlight. */
  testClearHighlight(): void;
  /** DEV test seam: set the highlight mode synchronously (bypasses storage). */
  testSetHighlightMode(mode: ReaderSettings["highlightMode"]): void;
  cleanup(): void;
}

export interface OverlayDependencies {
  /** Optional settings store; defaults to an in-memory fallback. */
  settingsStore?: SettingsStore;
  /** Optional engine controller; defaults to an empty Piper catalog. */
  engineController?: EngineController;
}

/** Build the overlay store for the current page. */
export function createOverlayStore(deps: OverlayDependencies = {}): OverlayStore {
  const article = extractArticle();
  const chunks = article?.chunks ?? [];
  const headingChunks = chunks
    .map((c, i) => (c.headingLevel !== null ? i : -1))
    .filter((i) => i >= 0);

  const position = createPositionStore({
    totalChunks: chunks.length,
    headingChunks,
    storage: createChromePositionStorage(),
    url: location.href,
  });
  const engineController = deps.engineController ?? createEngineController({ piperVoices: [] });
  const settingsStore = deps.settingsStore ?? createMemorySettingsStore();

  let state: OverlayState = { status: chunks.length > 0 ? "idle" : "idle" };
  let expanded = false;
  let settings = { ...DEFAULT_SETTINGS };
  // True once the highlight mode is set explicitly (UI or test seam). Prevents
  // the async settings-load init from clobbering it with the stored default.
  let modePinned = false;
  let engine: Engine = engineController.getEngine();
  let currentChunk: ArticleChunk | null = chunks[0] ?? null;
  let positionPercent = position.getPosition().percentComplete;
  const highlighter = createHighlighter(settings.highlightMode);
  let boundaryDisposer: (() => void) | null = null;

  const stateListeners = new Set<(state: OverlayState) => void>();
  const chunkListeners = new Set<(chunk: ArticleChunk | null) => void>();
  const expandedListeners = new Set<(expanded: boolean) => void>();

  function notifyState(): void {
    for (const listener of stateListeners) listener(state);
  }

  function notifyChunk(): void {
    for (const listener of chunkListeners) listener(currentChunk);
  }

  function notifyExpanded(): void {
    for (const listener of expandedListeners) listener(expanded);
  }
  function updateCurrentChunk(): void {
    currentChunk = chunks[position.getPosition().chunkIndex] ?? null;
    notifyChunk();
  }

  function syncEngine(): void {
    engine = engineController.getEngine();
    if (boundaryDisposer) {
      boundaryDisposer();
      boundaryDisposer = null;
    }
    boundaryDisposer = engine.onBoundary((e) => {
      if (state.status !== "playing") return;
      // Highlight the chunk currently being spoken, then advance position.
      if (currentChunk) {
        if (settings.highlightMode === "paragraph") {
          highlighter.set(toHighlightUnit(currentChunk));
        } else if (settings.highlightMode === "sentence") {
          highlighter.set(toSentenceHighlightUnit(currentChunk, e.charIndex));
        }
      }
      position.next();
      updateCurrentChunk();
    });
  }

  function speakCurrent(): void {
    if (!currentChunk) return;
    const opts: SpeakOpts = {
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      voiceUri: settings.voiceUri,
    };
    engine.speak(currentChunk.text, opts);
  }

  // The settings store fires `onChange` once on the initial load (with the
  // persisted/default settings) and again on every set(). The initial-load
  // fire must not clobber a mode already pinned by the UI or test seam.
  let initialSettingsApplied = false;
  const settingsDisposer = settingsStore.onChange((s) => {
    if (!initialSettingsApplied) {
      initialSettingsApplied = true;
      if (modePinned) {
        settings = { ...s, highlightMode: settings.highlightMode };
        highlighter.setMode(settings.highlightMode);
        return;
      }
    }
    settings = s;
    highlighter.setMode(s.highlightMode);
  });

  const positionDisposer = position.onChange(() => {
    positionPercent = position.getPosition().percentComplete;
    updateCurrentChunk();
  });

  const engineDisposer = engineController.onChange(() => {
    syncEngine();
  });

  // Initialize. Persisted settings are applied by the settingsDisposer's
  // initial-load fire once the store loads.
  syncEngine();
  updateCurrentChunk();

  return {
    get state() {
      return state;
    },
    get expanded() {
      return expanded;
    },
    get settings() {
      return { ...settings };
    },
    get currentChunk() {
      return currentChunk;
    },
    get positionPercent() {
      return positionPercent;
    },
    get engineKind() {
      return engineController.getKind();
    },
    play(): void {
      if (state.status === "playing") return;
      state = { status: "playing" };
      speakCurrent();
      notifyState();
    },
    pause(): void {
      if (state.status !== "playing") return;
      engine.pause();
      state = { status: "paused" };
      notifyState();
    },
    stop(): void {
      engine.stop();
      highlighter.clear();
      state = { status: "idle" };
      position.seek(0);
      updateCurrentChunk();
      notifyState();
    },
    toggleExpanded(): void {
      expanded = !expanded;
      notifyExpanded();
    },
    close(): void {
      engine.stop();
      highlighter.clear();
      expanded = false;
      notifyExpanded();
      notifyState();
    },
    setEngine(kind: "web-speech" | "piper"): void {
      engineController.select(kind);
    },
    setHighlightMode(mode: ReaderSettings["highlightMode"]): void {
      modePinned = true;
      void settingsStore.set({ highlightMode: mode });
    },
    setRate(rate: number): void {
      void settingsStore.set({ rate });
    },
    setVolume(volume: number): void {
      void settingsStore.set({ volume });
    },
    onStateChange(listener: (state: OverlayState) => void): () => void {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    onChunkChange(listener: (chunk: ArticleChunk | null) => void): () => void {
      chunkListeners.add(listener);
      return () => {
        chunkListeners.delete(listener);
      };
    },
    onExpandedChange(listener: (expanded: boolean) => void): () => void {
      expandedListeners.add(listener);
      return () => {
        expandedListeners.delete(listener);
      };
    },
    testDriveHighlight(chunkIndex: number, charOffset: number): void {
      position.seek(chunkIndex);
      updateCurrentChunk();
      if (!currentChunk) return;
      if (settings.highlightMode === "paragraph") {
        highlighter.set(toHighlightUnit(currentChunk));
      } else if (settings.highlightMode === "sentence") {
        highlighter.set(toSentenceHighlightUnit(currentChunk, charOffset));
      }
    },
    testClearHighlight(): void {
      highlighter.clear();
    },
    testSetHighlightMode(mode: ReaderSettings["highlightMode"]): void {
      modePinned = true;
      settings = { ...settings, highlightMode: mode };
      highlighter.setMode(mode);
    },
    cleanup(): void {
      engine.stop();
      highlighter.clear();
      settingsDisposer();
      positionDisposer();
      engineDisposer();
      if (boundaryDisposer) boundaryDisposer();
    },
  };
}

import { createSettingsStore, type StorageArea } from "$lib/features/settings/settings.js";

function createMemorySettingsStore(): SettingsStore {
  const area: StorageArea = {
    async get(): Promise<unknown> {
      return undefined;
    },
    async set(): Promise<void> {
      // no-op
    },
  };
  return createSettingsStore(area);
}
