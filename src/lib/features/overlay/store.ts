/**
 * Ticket 0013 — content-script overlay state + wiring.
 *
 * Coordinates extraction, the TTS controller, position tracking, settings,
 * and the Svelte overlay UI mounted in the Shadow DOM.
 */

import type { ArticleChunk } from "$lib/features/extraction";
import type { Highlighter, HighlightUnit } from "$lib/features/reading";
import type { ReaderSettings, SettingsStore } from "$lib/features/settings";
import type { EngineController, ResolvedEngine, SpeakOpts, Voice } from "$lib/features/tts";

import { extractArticle } from "$lib/features/extraction";
import { createHighlighter, toHighlightUnit, toSentenceHighlightUnit } from "$lib/features/reading";
import { createPositionStore, createChromePositionStorage } from "$lib/features/reading";
import { DEFAULT_SETTINGS } from "$lib/features/settings";
import { createSettingsStore, type StorageArea } from "$lib/features/settings";
import {
  createEngineController,
  createPiperEngine,
  createWebSpeechEngine,
} from "$lib/features/tts";

export type OverlayState = { status: "idle" } | { status: "playing" } | { status: "paused" };

/**
 * Ticket 0022 — smart-back threshold: seconds of audio played for the current
 * chunk above which the back button restarts the chunk instead of seeking to
 * the previous one. A single named constant in the coordinator.
 */
export const BACK_RESTART_THRESHOLD_SECONDS = 2;

/** Nav-state snapshot the UI uses to enable/disable prev/next (ticket 0022). */
export interface NavState {
  /** Back enabled: not at the first chunk, or past the restart threshold. */
  readonly canBack: boolean;
  /** Forward enabled: not at the last chunk. */
  readonly canForward: boolean;
  /** Seconds of audio played for the current chunk. */
  readonly elapsedInChunk: number;
}

/** A heading marker for the skip-to-section slider (ticket 0014). */
export interface HeadingMarker {
  /** 0-based chunk index of the heading chunk. */
  readonly chunkIndex: number;
  /** Heading text to display. */
  readonly text: string;
  /**
   * Char-weighted percent of the heading chunk (ticket 0022): the slider
   * thumb is a continuous 0–100 progress value and markers sit at each
   * heading's percent position.
   */
  readonly percent: number;
}

export interface OverlayStore {
  readonly state: OverlayState;
  readonly expanded: boolean;
  /** Whether the overlay has been activated (icon-click gate, bug 1). */
  readonly activated: boolean;
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
  /** Prev/next enablement + per-chunk elapsed time (ticket 0022). */
  readonly nav: NavState;
  /** Resolves once the engine controller is hydrated and wired. */
  readonly ready: Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  toggleExpanded(): void;
  close(): void;
  /** Jump to a specific chunk (skip-to-section navigation). */
  seek(chunkIndex: number): void;
  /** Jump to the chunk containing a 0–100 slider position (ticket 0022). */
  seekToPercent(percent: number): void;
  /** Forward: abort the current utterance, move one chunk, autoplay if playing. */
  nextChunk(): void;
  /** Smart-back: restart the current chunk past the threshold, else go back one. */
  backChunk(): void;
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
  /** One-way activation gate (icon click); does not reset on close. */
  activate(): void;
  /** Subscribe to activation changes. Returns a disposer. */
  onActivatedChange(listener: (activated: boolean) => void): () => void;
  /** Emits when back/forward enablement or per-chunk elapsed changes. */
  onNavChange(listener: (nav: NavState) => void): () => void;
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
  /** Optional highlighter; defaults to the real DOM highlighter. Test seam. */
  highlighter?: Highlighter;
}

/** Build the overlay store for the current page. */
export function createStore(deps: OverlayDependencies = {}): OverlayStore {
  const article = extractArticle();
  const chunks = article?.chunks ?? [];
  const headingChunks = chunks
    .map((c, i) => (c.headingLevel !== null ? i : -1))
    .filter((i) => i >= 0);

  const position = createPositionStore({
    totalChunks: chunks.length,
    headingChunks,
    // Ticket 0022: percent-complete is char-weighted (Σ completed-chunk chars
    // / total chars), so the slider thumb advances by chunk length.
    chunkCharLengths: chunks.map((c) => c.text.length),
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
  // One-way activation gate: the overlay stays hidden until the extension icon
  // is clicked (bug 1). Activation does NOT reset on close — it persists per
  // page load so a collapsed overlay can re-expand without re-activation.
  let activated = false;
  let settings = { ...DEFAULT_SETTINGS };
  // True once the highlight mode is set explicitly (UI or test seam). Prevents
  // the async settings-load init from clobbering it with the stored default.
  let modePinned = false;
  let engine: EngineController | null = null;
  let engineKind: ResolvedEngine = "piper";
  let voices: Voice[] = [];
  let currentChunk: ArticleChunk | null = chunks[0] ?? null;
  const highlighter = deps.highlighter ?? createHighlighter(settings.highlightMode);
  let positionPercent = position.getPosition().percentComplete;
  let boundaryDisposer: (() => void) | null = null;
  let endDisposer: (() => void) | null = null;
  let engineDisposer: (() => void) | null = null;
  let voicesDisposer: (() => void) | null = null;
  let cleanedUp = false;

  const stateListeners = new Set<(state: OverlayState) => void>();
  const chunkListeners = new Set<(chunk: ArticleChunk | null) => void>();
  const expandedListeners = new Set<(expanded: boolean) => void>();
  const activatedListeners = new Set<(activated: boolean) => void>();
  const engineListeners = new Set<(kind: ResolvedEngine) => void>();
  const settingsListeners = new Set<(settings: ReaderSettings) => void>();
  const voicesListeners = new Set<(voices: Voice[]) => void>();
  const navListeners = new Set<(nav: NavState) => void>();

  // --- Ticket 0022: per-chunk elapsed time (smart-back) -----------------------
  // Lives in the coordinator, not the adapters: a wall-clock ticker started
  // when an utterance is spoken, reset on pause/stop/seek/chunk change. The
  // engine surface reports no start/end events, so speak-invocation time is
  // the timing source — for a 2s threshold the difference is negligible, and
  // the E2E (which drives silent Piper) depends on this coordinator clock.
  const ELAPSED_TICK_MS = 250;
  let elapsedInChunk = 0;
  // lib.dom's setInterval returns a number in browser contexts.
  let elapsedTimer: number | null = null;
  let elapsedStartedAt = 0;
  let elapsedPastThreshold = false;

  function stopElapsedTimer(): void {
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  /** Reset elapsed to zero and stop the ticker; notifies nav listeners. */
  function resetElapsed(): void {
    stopElapsedTimer();
    elapsedInChunk = 0;
    elapsedPastThreshold = false;
    notifyNav();
  }

  /** Start ticking elapsed for a newly spoken chunk (already playing). */
  function startElapsedTimer(): void {
    stopElapsedTimer();
    elapsedInChunk = 0;
    elapsedPastThreshold = false;
    elapsedStartedAt = Date.now();
    elapsedTimer = setInterval(() => {
      elapsedInChunk = (Date.now() - elapsedStartedAt) / 1000;
      // Only the threshold crossing matters for back-button enablement; the
      // elapsed value itself is read via the `nav` getter.
      if (!elapsedPastThreshold && elapsedInChunk > BACK_RESTART_THRESHOLD_SECONDS) {
        elapsedPastThreshold = true;
        notifyNav();
      }
    }, ELAPSED_TICK_MS);
    notifyNav();
  }

  function currentNav(): NavState {
    const chunkIndex = position.getPosition().chunkIndex;
    return {
      canBack: chunkIndex > 0 || elapsedInChunk > BACK_RESTART_THRESHOLD_SECONDS,
      canForward: chunks.length > 0 && chunkIndex < chunks.length - 1,
      elapsedInChunk,
    };
  }

  function notifyNav(): void {
    const nav = currentNav();
    for (const listener of navListeners) listener(nav);
  }

  function notifyState(): void {
    for (const listener of stateListeners) listener(state);
  }

  function notifyChunk(): void {
    for (const listener of chunkListeners) listener(currentChunk);
  }

  function notifyExpanded(): void {
    for (const listener of expandedListeners) listener(expanded);
  }

  function notifyActivated(): void {
    for (const listener of activatedListeners) listener(activated);
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
    // A freshly spoken chunk starts its elapsed clock (ticket 0022).
    startElapsedTimer();
  }

  /** Scroll the given chunk's element into view after a navigation seek. */
  function scrollChunkIntoView(chunk: ArticleChunk | null): void {
    if (!chunk) return;
    try {
      const element = document.querySelector(chunk.anchor);
      if (element && typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch {
      // Non-CSS anchors (e.g. `pdf:page=2`) — nothing to scroll.
    }
  }

  /**
   * Abort the current utterance and speak the (already-selected) current
   * chunk from its top. Used by forward/back autoplay (ticket 0022); the
   * stop runs before the new speak so the old audio never overlaps.
   */
  function stopAndSpeakCurrent(): void {
    void ready.then(() => {
      if (cleanedUp || state.status !== "playing") return;
      engine?.stop();
      speakCurrent();
    });
  }

  /** Abort the current utterance without speaking (paused navigation). */
  function abortCurrent(): void {
    void ready.then(() => {
      if (cleanedUp) return;
      engine?.stop();
    });
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

  /** Derive the highlight unit for the active chunk from the reading position.
   * The position subscription re-evaluates this on every change so the active
   * chunk is always highlighted (bug 2) — not only when an audio boundary
   * next fires. Paragraph mode highlights the whole chunk; sentence mode
   * highlights its first sentence until a boundary refines it; "off" yields
   * null (no highlight). */
  function deriveHighlightUnit(chunk: ArticleChunk): HighlightUnit | null {
    if (settings.highlightMode === "sentence") return toSentenceHighlightUnit(chunk, 0);
    if (settings.highlightMode === "paragraph") return toHighlightUnit(chunk);
    return null;
  }

  /** Re-apply the active-chunk highlight when the reading position is
   * meaningful (playing or paused) — skipped while idle so stop()'s cleared
   * highlight is not re-applied by its reset seek. */
  function applyActiveHighlight(): void {
    if (cleanedUp || state.status === "idle" || !currentChunk) return;
    const unit = deriveHighlightUnit(currentChunk);
    if (unit) highlighter.set(unit);
  }

  // The highlight is a derived effect of the reading position: subscribe via
  // the position store's Svelte-readable surface and re-derive on every
  // change (seek, skip, boundary advance, restore) so the active chunk is
  // always highlighted (bug 2). The immediate emit at construction is a no-op
  // (state is idle).
  const positionDisposer = position.subscribe(() => {
    positionPercent = position.getPosition().percentComplete;
    updateCurrentChunk();
    // Chunk change or seek (boundary advance, slider, restore): the elapsed
    // clock belongs to the chunk that was just spoken — reset it (ticket 0022).
    resetElapsed();
    applyActiveHighlight();
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
      // Boundary fires once per WORD (Web Speech), so it must only advance the
      // within-chunk highlight — NOT the reading position. Advancing the chunk
      // on every word boundary was bug 3 (rapid highlight jumps to later
      // paragraphs). Chunk advance is the onEnd handler's job (bug 2 fix).
      if (currentChunk) {
        if (settings.highlightMode === "paragraph") {
          highlighter.set(toHighlightUnit(currentChunk));
        } else if (settings.highlightMode === "sentence") {
          highlighter.set(toSentenceHighlightUnit(currentChunk, e.charIndex));
        }
      }
    });
    // Bug 2 fix: advance to and speak the next chunk when an utterance ends.
    // The controller relays onEnd only from the engine currently driving
    // playback. Engines now suppress cancel/superseded ends with a generation
    // token (Piper's currentToken/playingToken; Web Speech's utterance token),
    // so onEnd here means natural completion — the play-state guard is a
    // belt-and-suspenders against an end arriving after the user stopped.
    endDisposer = controller.onEnd(() => {
      if (state.status !== "playing") return;
      const atEnd = position.getPosition().chunkIndex >= chunks.length - 1;
      if (atEnd) {
        state = { status: "idle" };
        highlighter.clear();
        resetElapsed();
        notifyState();
        return;
      }
      position.next();
      updateCurrentChunk();
      speakCurrent();
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
    get activated() {
      return activated;
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
    get nav(): NavState {
      return currentNav();
    },
    get headings(): HeadingMarker[] {
      return headingChunks.map((chunkIndex) => {
        const chunk = chunks[chunkIndex]!;
        return {
          chunkIndex,
          text: chunk.headingText ?? chunk.text,
          percent: position.percentAt(chunkIndex),
        };
      });
    },
    get currentHeadingIndex(): number | null {
      return position.getPosition().headingIndex;
    },
    play(): void {
      if (state.status === "playing") return;
      // Bug 1: a paused→playing transition resumes the paused utterance at its
      // offset when the engine still has a live one (engine.isPaused()); only a
      // fresh start (idle) or a lost utterance (Chrome auto-stops speechSynthesis
      // after ~15s of silence) re-speaks the current chunk from its top.
      const resuming = state.status === "paused";
      state = { status: "playing" };
      notifyState();
      void ready.then(() => {
        if (state.status !== "playing") return;
        if (resuming && engine?.isPaused()) {
          engine.resume();
          startElapsedTimer();
        } else {
          speakCurrent();
        }
      });
    },
    pause(): void {
      if (state.status !== "playing") return;
      state = { status: "paused" };
      notifyState();
      resetElapsed();
      void ready.then(() => engine?.pause());
    },
    stop(): void {
      void ready.then(() => engine?.stop());
      highlighter.clear();
      state = { status: "idle" };
      resetElapsed();
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
      resetElapsed();
      expanded = false;
      notifyExpanded();
      notifyState();
    },
    seek(chunkIndex: number): void {
      position.seek(chunkIndex);
      scrollChunkIntoView(currentChunk);
    },
    seekToPercent(percent: number): void {
      position.seekToPercent(percent);
      scrollChunkIntoView(currentChunk);
    },
    nextChunk(): void {
      const current = position.getPosition();
      if (chunks.length === 0 || current.chunkIndex >= chunks.length - 1) return;
      const wasPlaying = state.status === "playing";
      position.seek(current.chunkIndex + 1);
      scrollChunkIntoView(currentChunk);
      // Abort the current utterance in both cases; autoplay only if playing.
      if (wasPlaying) stopAndSpeakCurrent();
      else abortCurrent();
    },
    backChunk(): void {
      const current = position.getPosition();
      // Smart-back: past the threshold, restart the current chunk from its
      // top (chunkIndex unchanged, keeps playing/paused state).
      if (elapsedInChunk > BACK_RESTART_THRESHOLD_SECONDS) {
        if (state.status === "playing") stopAndSpeakCurrent();
        return;
      }
      // Within the threshold: disabled at the first chunk.
      if (current.chunkIndex <= 0) return;
      const wasPlaying = state.status === "playing";
      position.seek(current.chunkIndex - 1);
      scrollChunkIntoView(currentChunk);
      if (wasPlaying) stopAndSpeakCurrent();
      else abortCurrent();
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
    activate(): void {
      activated = true;
      notifyActivated();
    },
    onActivatedChange(listener: (activated: boolean) => void): () => void {
      activatedListeners.add(listener);
      return () => {
        activatedListeners.delete(listener);
      };
    },
    onNavChange(listener: (nav: NavState) => void): () => void {
      navListeners.add(listener);
      return () => {
        navListeners.delete(listener);
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
      stopElapsedTimer();
      void ready.then(() => engine?.stop());
      highlighter.clear();
      settingsDisposer();
      positionDisposer();
      if (boundaryDisposer) boundaryDisposer();
      if (endDisposer) endDisposer();
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
