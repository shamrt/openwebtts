/**
 * Ticket 0013 — content-script overlay state + wiring.
 *
 * Coordinates extraction, the TTS controller, position tracking, settings,
 * and the Svelte overlay UI mounted in the Shadow DOM.
 */

import type { ArticleChunk } from "$lib/features/extraction/html-extractor.js";
import type { ReaderSettings, SettingsStore } from "$lib/features/settings/settings.js";
import type { EngineController, ResolvedEngine, SpeakOpts, Voice } from "$lib/features/tts";

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
import { createSettingsStore, type StorageArea } from "$lib/features/settings/settings.js";
import {
  createEngineController,
  createPiperEngine,
  createWebSpeechEngine,
} from "$lib/features/tts";

export type OverlayState = { status: "idle" } | { status: "playing" } | { status: "paused" };

/** A heading marker for the skip-to-section slider (ticket 0014). */
export interface HeadingMarker {
  /** 0-based chunk index of the heading chunk. */
  readonly chunkIndex: number;
  /** Heading text to display. */
  readonly text: string;
}

export interface OverlayStore {
  readonly state: OverlayState;
  readonly expanded: boolean;
  readonly currentChunk: ArticleChunk | null;
  readonly positionPercent: number;
  readonly engineKind: ResolvedEngine;
  /** Voices available on the active engine (ticket 0015). */
  readonly voices: Voice[];
  /** Heading chunks in reading order, for the skip-to-section slider. */
  readonly headings: HeadingMarker[];
  /** Index into {@link headings} for the current section, or null when none. */
  readonly currentHeadingIndex: number | null;
  /** Current settings snapshot. */
  readonly settings: ReaderSettings;
  /** Resolves once the engine controller is hydrated and wired. */
  readonly ready: Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  toggleExpanded(): void;
  close(): void;
  /** Jump to a specific chunk (skip-to-section navigation). */
  seek(chunkIndex: number): void;
  /** Select an engine kind; persisted by the controller. */
  setEngine(kind: ResolvedEngine): Promise<void>;
  setHighlightMode(mode: ReaderSettings["highlightMode"]): void;
  setRate(rate: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setPitch(pitch: number): Promise<void>;
  setVoice(voiceUri: string): Promise<void>;
  onStateChange(listener: (state: OverlayState) => void): () => void;
  onChunkChange(listener: (chunk: ArticleChunk | null) => void): () => void;
  onExpandedChange(listener: (expanded: boolean) => void): () => void;
  onEngineChange(listener: (kind: ResolvedEngine) => void): () => void;
  onSettingsChange(listener: (settings: ReaderSettings) => void): () => void;
  onVoicesChange(listener: (voices: Voice[]) => void): () => void;
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
  /** Optional engine controller; defaults to the hybrid Web Speech/Piper controller. */
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
  const settingsStore = deps.settingsStore ?? createMemorySettingsStore();
  // The engine controller hydrates its persisted selection from storage
  // asynchronously; the store stays constructible synchronously and exposes
  // `ready` for consumers (and tests) that need the resolved engine.
  const engineControllerPromise = deps.engineController
    ? Promise.resolve(deps.engineController)
    : createEngineController({
        webSpeech: createWebSpeechEngine(),
        piper: createPiperEngine({ voices: [] }),
      });

  let state: OverlayState = { status: "idle" };
  let expanded = false;
  let settings = { ...DEFAULT_SETTINGS };
  // True once the highlight mode is set explicitly (UI or test seam). Prevents
  // the async settings-load init from clobbering it with the stored default.
  let modePinned = false;
  let engine: EngineController | null = null;
  let engineKind: ResolvedEngine = "piper";
  let voices: Voice[] = [];
  let currentChunk: ArticleChunk | null = chunks[0] ?? null;
  let positionPercent = position.getPosition().percentComplete;
  const highlighter = createHighlighter(settings.highlightMode);
  let boundaryDisposer: (() => void) | null = null;
  let engineDisposer: (() => void) | null = null;
  let voicesDisposer: (() => void) | null = null;
  let cleanedUp = false;

  const stateListeners = new Set<(state: OverlayState) => void>();
  const chunkListeners = new Set<(chunk: ArticleChunk | null) => void>();
  const expandedListeners = new Set<(expanded: boolean) => void>();
  const engineListeners = new Set<(kind: ResolvedEngine) => void>();
  const settingsListeners = new Set<(settings: ReaderSettings) => void>();
  const voicesListeners = new Set<(voices: Voice[]) => void>();

  function notifyState(): void {
    for (const listener of stateListeners) listener(state);
  }

  function notifyChunk(): void {
    for (const listener of chunkListeners) listener(currentChunk);
  }

  function notifyExpanded(): void {
    for (const listener of expandedListeners) listener(expanded);
  }

  function notifyEngineKind(): void {
    for (const listener of engineListeners) listener(engineKind);
  }

  function notifySettings(): void {
    for (const listener of settingsListeners) listener({ ...settings });
  }

  function notifyVoices(): void {
    for (const listener of voicesListeners) listener(voices);
  }

  function updateCurrentChunk(): void {
    currentChunk = chunks[position.getPosition().chunkIndex] ?? null;
    notifyChunk();
  }

  /** Re-read the active engine's voice list (engine switch, voiceschanged). */
  async function refreshVoices(): Promise<void> {
    if (!engine) return;
    voices = await engine.getVoices();
    notifyVoices();
  }

  function speakCurrent(): void {
    if (!currentChunk || !engine) return;
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
        notifySettings();
        return;
      }
    }
    settings = s;
    highlighter.setMode(s.highlightMode);
    notifySettings();
  });

  const positionDisposer = position.onChange(() => {
    positionPercent = position.getPosition().percentComplete;
    updateCurrentChunk();
  });

  // Wire the engine once the controller has hydrated its persisted selection.
  // The controller is a drop-in Engine: it relays speak/stop/pause/boundaries
  // from whichever backend is resolved, so no re-wiring is needed on switch.
  const ready = engineControllerPromise.then(async (controller) => {
    if (cleanedUp) return;
    engine = controller;
    engineKind = controller.getCurrentEngine();
    notifyEngineKind();
    boundaryDisposer = controller.onBoundary((e) => {
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
    engineDisposer = controller.onCurrentEngine((kind) => {
      engineKind = kind;
      notifyEngineKind();
      void refreshVoices();
    });
    voicesDisposer = controller.onVoicesChanged((next) => {
      voices = next;
      notifyVoices();
    });
    await refreshVoices();
  });

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
      return engineKind;
    },
    get voices() {
      return voices;
    },
    get ready() {
      return ready;
    },
    get headings(): HeadingMarker[] {
      return headingChunks.map((chunkIndex) => {
        const chunk = chunks[chunkIndex]!;
        return { chunkIndex, text: chunk.headingText ?? chunk.text };
      });
    },
    get currentHeadingIndex(): number | null {
      return position.getPosition().headingIndex;
    },
    play(): void {
      if (state.status === "playing") return;
      state = { status: "playing" };
      notifyState();
      void ready.then(() => {
        if (state.status !== "playing") return;
        speakCurrent();
      });
    },
    pause(): void {
      if (state.status !== "playing") return;
      state = { status: "paused" };
      notifyState();
      void ready.then(() => engine?.pause());
    },
    stop(): void {
      void ready.then(() => engine?.stop());
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
      void ready.then(() => engine?.stop());
      highlighter.clear();
      expanded = false;
      notifyExpanded();
      notifyState();
    },
    seek(chunkIndex: number): void {
      position.seek(chunkIndex);
    },
    async setEngine(kind: ResolvedEngine): Promise<void> {
      await ready;
      if (!engine) return;
      await engine.setSelection(kind);
      await refreshVoices();
    },
    setHighlightMode(mode: ReaderSettings["highlightMode"]): void {
      modePinned = true;
      void settingsStore.set({ highlightMode: mode });
    },
    setRate(rate: number): Promise<void> {
      return settingsStore.set({ rate });
    },
    setVolume(volume: number): Promise<void> {
      return settingsStore.set({ volume });
    },
    setPitch(pitch: number): Promise<void> {
      return settingsStore.set({ pitch });
    },
    setVoice(voiceUri: string): Promise<void> {
      return settingsStore.set({ voiceUri });
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
    onEngineChange(listener: (kind: ResolvedEngine) => void): () => void {
      engineListeners.add(listener);
      return () => {
        engineListeners.delete(listener);
      };
    },
    onSettingsChange(listener: (settings: ReaderSettings) => void): () => void {
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    },
    onVoicesChange(listener: (voices: Voice[]) => void): () => void {
      voicesListeners.add(listener);
      return () => {
        voicesListeners.delete(listener);
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
      cleanedUp = true;
      void ready.then(() => engine?.stop());
      highlighter.clear();
      settingsDisposer();
      positionDisposer();
      if (boundaryDisposer) boundaryDisposer();
      if (engineDisposer) engineDisposer();
      if (voicesDisposer) voicesDisposer();
    },
  };
}

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
