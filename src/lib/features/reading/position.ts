/**
 * Ticket 0011 — track reading position and progress.
 *
 * Holds the read-state the UI and highlighting read: current chunk index,
 * heading index, and percent-complete. Emits change events on updates and
 * persists the last position per-URL.
 */

/** Read position snapshot. */
export interface ReadingPosition {
  /** 0-based chunk index in the current article. */
  chunkIndex: number;
  /** 0-based index among heading chunks (null when no headings). */
  headingIndex: number | null;
  /** Percent complete, 0–100, rounded to one decimal. */
  percentComplete: number;
}

/** Listener for position changes. */
export type PositionChangeListener = (position: ReadingPosition) => void;

export interface PositionStore {
  /** Move to a specific chunk index. */
  seek(chunkIndex: number): void;
  /** Move to the chunk containing the given percent position (0–100). */
  seekToPercent(percent: number): void;
  /** Advance one chunk, if possible. */
  next(): void;
  /** Retreat one chunk, if possible. */
  previous(): void;
  /** Char-weighted percent at the given chunk (0–100, one decimal). */
  percentAt(chunkIndex: number): number;
  /** Current position snapshot. */
  getPosition(): ReadingPosition;
  /** Subscribe to position changes. Returns disposer. */
  onChange(listener: PositionChangeListener): () => void;
}

/**
 * Minimal per-URL numeric storage used to persist the reading position.
 * Mirrors the {@link StorageArea} idea from settings.ts but narrowed to a
 * single number per key.
 */
export interface PositionStorage {
  get(key: string): Promise<number | undefined>;
  set(key: string, value: number): Promise<void>;
}

/** Options for {@link createPositionStore}. */
export interface CreatePositionStoreOptions {
  totalChunks: number;
  headingChunks: readonly number[];
  /**
   * Per-chunk char lengths (ticket 0022). When omitted, every chunk counts
   * as one char (uniform weighting). Percent-complete is the share of chars
   * in chunks completed BEFORE the current chunk.
   */
  chunkCharLengths?: readonly number[];
  /** Optional per-URL persistence adapter. */
  storage?: PositionStorage;
  /** URL the position is scoped to. Required when `storage` is given. */
  url?: string;
}

/** Build a PositionStore for an article with the given number of chunks. */
export function createPositionStore(options: CreatePositionStoreOptions): PositionStore {
  const totalChunks = Math.max(0, options.totalChunks);
  const headingChunks = options.headingChunks;
  const storage = options.storage;
  const url = options.url;
  const positionKey = url ? `reading-position:${url}` : "";
  let chunkIndex = 0;
  const listeners = new Set<PositionChangeListener>();

  // Char weights: missing/negative entries default to one char so a partial
  // or omitted chunkCharLengths still yields a well-formed 0–100 model.
  const charLengths: number[] = [];
  let totalChars = 0;
  for (let i = 0; i < totalChunks; i++) {
    const raw = options.chunkCharLengths?.[i];
    const len = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 1;
    charLengths.push(len);
    totalChars += len;
  }

  /** Chars in chunks completed before `chunk` (chunks 0..chunk-1). */
  function completedCharsBefore(chunk: number): number {
    let sum = 0;
    for (let i = 0; i < chunk && i < charLengths.length; i++) sum += charLengths[i]!;
    return sum;
  }

  function headingIndexAt(chunk: number): number | null {
    let found: number | null = null;
    for (let i = headingChunks.length - 1; i >= 0; i--) {
      if (headingChunks[i]! <= chunk) {
        found = i;
        break;
      }
    }
    return found;
  }

  function computePercent(chunk: number): number {
    if (totalChars === 0) return 0;
    const bounded = Math.max(0, Math.min(chunk, totalChunks - 1));
    return Math.round((completedCharsBefore(bounded) / totalChars) * 1000) / 10;
  }

  /** Chunk index whose char range contains the given percent position. */
  function chunkAtPercent(percent: number): number {
    if (totalChars === 0) return 0;
    const p = (Math.max(0, Math.min(percent, 100)) / 100) * totalChars;
    let cum = 0;
    for (let i = 0; i < charLengths.length; i++) {
      cum += charLengths[i]!;
      // Strict: a position exactly at a chunk's start belongs to that chunk,
      // so seeking to a heading's start-percent lands on the heading chunk.
      if (cum > p) return i;
    }
    return totalChunks - 1;
  }

  function currentPosition(): ReadingPosition {
    return {
      chunkIndex,
      headingIndex: headingIndexAt(chunkIndex),
      percentComplete: computePercent(chunkIndex),
    };
  }

  function notify(): void {
    const position = currentPosition();
    for (const listener of listeners) {
      listener(position);
    }
  }

  function seek(chunkIndexValue: number): void {
    const target = Math.max(0, Math.min(chunkIndexValue, Math.max(0, totalChunks - 1)));
    const changed = target !== chunkIndex;
    chunkIndex = target;
    if (changed) notify();
    // Best-effort persist of the current chunkIndex per URL; never throws —
    // storage rejections are swallowed so playback is never blocked.
    if (storage && url) {
      storage.set(positionKey, chunkIndex).catch(() => {
        // best-effort: ignore storage rejections
      });
    }
  }

  // On construction, if storage + url are provided, restore the last position
  // for that URL. This is async and MUST NOT block construction: the store is
  // usable immediately at chunk 0; once the stored index (if any) is read and
  // validated, we move there and notify listeners exactly once.
  function restore(): void {
    if (!storage || !url) return;
    storage
      .get(positionKey)
      .then((stored) => {
        if (
          typeof stored === "number" &&
          Number.isFinite(stored) &&
          stored >= 0 &&
          totalChunks > 0 &&
          stored <= totalChunks - 1
        ) {
          chunkIndex = Math.floor(stored);
          notify();
        }
      })
      .catch(() => {
        // best-effort restore; ignore storage rejections
      });
  }

  restore();

  return {
    seek,
    seekToPercent(percent: number): void {
      seek(chunkAtPercent(percent));
    },
    next(): void {
      seek(chunkIndex + 1);
    },
    previous(): void {
      seek(chunkIndex - 1);
    },
    percentAt(chunk: number): number {
      return computePercent(chunk);
    },
    getPosition: currentPosition,
    onChange(listener: PositionChangeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The `chrome.storage.local` (or `browser.storage.local`) surface we use. */
interface BrowserStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * Adapts `chrome.storage.local` (or `browser.storage.local`) to
 * {@link PositionStorage}. Returns a no-op adapter when neither global is
 * present, so this module imports cleanly in Vitest (node) and on builds
 * without a storage area.
 */
export function createChromePositionStorage(): PositionStorage {
  const g = globalThis as Record<string, unknown>;
  let area: BrowserStorageLocal | null = null;
  const chromeGlobal = g.chrome;
  if (typeof chromeGlobal === "object" && chromeGlobal !== null) {
    const local = (chromeGlobal as { storage?: { local?: BrowserStorageLocal } }).storage?.local;
    if (local) area = local;
  }
  if (!area) {
    const browserGlobal = g.browser;
    if (typeof browserGlobal === "object" && browserGlobal !== null) {
      const local = (browserGlobal as { storage?: { local?: BrowserStorageLocal } }).storage?.local;
      if (local) area = local;
    }
  }
  if (!area) {
    return {
      async get(): Promise<number | undefined> {
        return undefined;
      },
      async set(): Promise<void> {
        // no-op: storage unavailable (node test env, build without storage)
      },
    };
  }
  const resolved = area;
  return {
    async get(key: string): Promise<number | undefined> {
      const result = await resolved.get(key);
      const value = result[key];
      return typeof value === "number" ? value : undefined;
    },
    async set(key: string, value: number): Promise<void> {
      await resolved.set({ [key]: value });
    },
  };
}
