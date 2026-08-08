/**
 * Ticket 0015 — voice, speed, and highlighting settings with persistence.
 *
 * A lightweight observable settings store backed by extension storage. It is
 * read by the overlay ([[0013]]) and the engine controller ([[0007]]) and the
 * highlighter ([[0016]]).
 */

export type HighlightMode = "off" | "paragraph" | "sentence";

export interface ReaderSettings {
  /** URI of the selected voice. */
  voiceUri: string;
  /** Playback speed, 0.5–2.0. */
  rate: number;
  /** Pitch shift, 0.5–2.0. */
  pitch: number;
  /** Volume, 0–1. */
  volume: number;
  /** As-you-read highlighting granularity. */
  highlightMode: HighlightMode;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  voiceUri: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  highlightMode: "paragraph",
};

export type SettingsChangeListener = (settings: ReaderSettings) => void;

export interface SettingsStore {
  /** Current settings snapshot. */
  get(): ReaderSettings;
  /** Replace all settings. */
  set(settings: Partial<ReaderSettings>): Promise<void>;
  /** Restore defaults. */
  reset(): Promise<void>;
  /** Subscribe to changes. Returns disposer. */
  onChange(listener: SettingsChangeListener): () => void;
  /** Promise that resolves once the initial load from storage completes. */
  loaded: Promise<void>;
}

const STORAGE_KEY = "reader-settings";

/** Build a SettingsStore bound to a storage area. */
export function createSettingsStore(storage: StorageArea): SettingsStore {
  let settings: ReaderSettings = { ...DEFAULT_SETTINGS };
  const listeners = new Set<SettingsChangeListener>();

  function notify(): void {
    for (const listener of listeners) {
      listener({ ...settings });
    }
  }

  async function load(): Promise<void> {
    const stored = await storage.get(STORAGE_KEY);
    if (stored && typeof stored === "object") {
      settings = { ...DEFAULT_SETTINGS, ...(stored as Partial<ReaderSettings>) };
      const mode = settings.highlightMode;
      if (!isValidHighlightMode(mode)) {
        settings.highlightMode = DEFAULT_SETTINGS.highlightMode;
      }
    }
  }

  // Kick off load but don't block construction. Return a promise for tests.
  const loaded = load().then(notify);

  return {
    get(): ReaderSettings {
      return { ...settings };
    },
    async set(partial: Partial<ReaderSettings>): Promise<void> {
      settings = { ...settings, ...partial };
      if (partial.highlightMode && !isValidHighlightMode(partial.highlightMode)) {
        settings.highlightMode = DEFAULT_SETTINGS.highlightMode;
      }
      await storage.set(STORAGE_KEY, { ...settings });
      notify();
    },
    async reset(): Promise<void> {
      settings = { ...DEFAULT_SETTINGS };
      await storage.set(STORAGE_KEY, { ...settings });
      notify();
    },
    onChange(listener: SettingsChangeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loaded,
  };
}

function isValidHighlightMode(value: string): value is HighlightMode {
  return value === "off" || value === "paragraph" || value === "sentence";
}

/** Minimal storage abstraction for tests and chrome.storage.local. */
export interface StorageArea {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Adapts `chrome.storage.local` (or `browser.storage.local`) to StorageArea. */
export function chromeStorageArea(storage: {
  get: (key: string) => Promise<record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}): StorageArea {
  return {
    async get(key: string): Promise<unknown> {
      const result = await storage.get(key);
      return result[key];
    },
    async set(key: string, value: unknown): Promise<void> {
      await storage.set({ [key]: value });
    },
  };
}
