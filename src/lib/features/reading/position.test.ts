/**
 * Ticket 0011 — tests for the reading position store.
 */

import { describe, expect, it } from "vite-plus/test";

import type { PositionStorage, ReadingPosition } from "./position.js";

import { createPositionStore } from "./position.js";

/** In-memory PositionStorage keyed by url; resolves async like chrome. */
function createMemoryStorage(): PositionStorage & {
  store: Map<string, number>;
} {
  const store = new Map<string, number>();
  return {
    store,
    async get(key: string): Promise<number | undefined> {
      return store.get(key);
    },
    async set(key: string, value: number): Promise<void> {
      store.set(key, value);
    },
  };
}

describe("createPositionStore", () => {
  it("starts at chunk 0, percent 0, and null heading when no headings", () => {
    const store = createPositionStore({ totalChunks: 5, headingChunks: [] });
    expect(store.getPosition()).toEqual({
      chunkIndex: 0,
      headingIndex: null,
      percentComplete: 0,
    });
  });

  it("reports the correct heading index at each chunk", () => {
    // Headings at chunks 0 and 3.
    const store = createPositionStore({ totalChunks: 6, headingChunks: [0, 3] });
    store.seek(0);
    expect(store.getPosition().headingIndex).toBe(0);
    store.seek(2);
    expect(store.getPosition().headingIndex).toBe(0);
    store.seek(3);
    expect(store.getPosition().headingIndex).toBe(1);
    store.seek(5);
    expect(store.getPosition().headingIndex).toBe(1);
  });

  it("computes percent-complete rounded to one decimal (uniform default weights)", () => {
    // Without chunkCharLengths every chunk counts as 1 char; percent is the
    // share of chars completed BEFORE the current chunk (ticket 0022 model).
    const store = createPositionStore({ totalChunks: 5, headingChunks: [] });
    store.seek(2);
    expect(store.getPosition().percentComplete).toBe(40);
    store.next();
    expect(store.getPosition().percentComplete).toBe(60);
    store.previous();
    expect(store.getPosition().percentComplete).toBe(40);
  });

  it("emits change events on position updates", () => {
    const store = createPositionStore({ totalChunks: 4, headingChunks: [] });
    const changes: ReadingPosition[] = [];
    const dispose = store.onChange((pos) => changes.push(pos));

    store.next();
    store.next();
    store.previous();

    expect(changes).toHaveLength(3);
    expect(changes[0].chunkIndex).toBe(1);
    expect(changes[1].chunkIndex).toBe(2);
    expect(changes[2].chunkIndex).toBe(1);

    dispose();
  });

  it("does not emit when seeking the same chunk", () => {
    const store = createPositionStore({ totalChunks: 4, headingChunks: [] });
    const changes: ReadingPosition[] = [];
    const dispose = store.onChange((pos) => changes.push(pos));
    store.seek(1);
    store.seek(1);
    expect(changes).toHaveLength(1);
    dispose();
  });

  it("clamps out-of-bounds seeks", () => {
    const store = createPositionStore({ totalChunks: 3, headingChunks: [] });
    store.seek(-5);
    expect(store.getPosition().chunkIndex).toBe(0);
    store.seek(100);
    expect(store.getPosition().chunkIndex).toBe(2);
  });

  it("persists chunkIndex across a second store instance with the same url", async () => {
    const storage = createMemoryStorage();
    const url = "https://example.com/article";

    const first = createPositionStore({
      totalChunks: 6,
      headingChunks: [0, 3],
      storage,
      url,
    });
    first.seek(4);
    // seek persists best-effort; let it settle before constructing the next store.
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.store.get(`reading-position:${url}`)).toBe(4);

    // A fresh store for the same URL restores the persisted chunk index.
    const second = createPositionStore({
      totalChunks: 6,
      headingChunks: [0, 3],
      storage,
      url,
    });
    // Restore is async and must not block construction; let the microtask flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(second.getPosition().chunkIndex).toBe(4);
    // Restored position carries the correct derived heading index + percent.
    expect(second.getPosition().headingIndex).toBe(1);
    // 6 uniform chunks: 4 chars completed before chunk 4 → 4/6.
    expect(second.getPosition().percentComplete).toBe(66.7);
  });

  it("ignores a persisted index that is out of bounds", async () => {
    const storage = createMemoryStorage();
    const url = "https://example.com/short";
    // Pre-seed an out-of-bounds index (beyond totalChunks for the next store).
    storage.store.set(`reading-position:${url}`, 99);

    const store = createPositionStore({
      totalChunks: 3,
      headingChunks: [],
      storage,
      url,
    });
    await Promise.resolve();
    await Promise.resolve();

    // Invalid persisted index is ignored; position stays at chunk 0.
    expect(store.getPosition().chunkIndex).toBe(0);
    expect(store.getPosition().percentComplete).toBe(0);
  });

  it("ignores a persisted index that is negative", async () => {
    const storage = createMemoryStorage();
    const url = "https://example.com/neg";
    storage.store.set(`reading-position:${url}`, -3);

    const store = createPositionStore({
      totalChunks: 3,
      headingChunks: [],
      storage,
      url,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getPosition().chunkIndex).toBe(0);
  });

  it("notifies listeners once after restoring the persisted position", async () => {
    const storage = createMemoryStorage();
    const url = "https://example.com/notify";
    storage.store.set(`reading-position:${url}`, 2);

    const store = createPositionStore({
      totalChunks: 5,
      headingChunks: [],
      storage,
      url,
    });
    const changes: ReadingPosition[] = [];
    const dispose = store.onChange((pos) => changes.push(pos));
    await Promise.resolve();
    await Promise.resolve();

    // Exactly one restore notification carrying the restored chunk.
    expect(changes).toHaveLength(1);
    expect(changes[0].chunkIndex).toBe(2);
    dispose();
  });

  it("does not persist when no storage is provided (backward-compatible path)", () => {
    // No storage: behaves exactly like the pre-persistence store.
    const store = createPositionStore({ totalChunks: 4, headingChunks: [] });
    store.seek(2);
    store.next();
    store.previous();
    expect(store.getPosition().chunkIndex).toBe(2);
    // No storage object exists to inspect; the absence of throw + correct
    // derived position is the contract here.
    expect(store.getPosition().percentComplete).toBe(50);
  });

  it("does not throw when storage rejects on set (best-effort persist)", () => {
    const failing: PositionStorage = {
      async get(): Promise<number | undefined> {
        return undefined;
      },
      async set(): Promise<void> {
        return Promise.reject(new Error("storage full"));
      },
    };
    const store = createPositionStore({
      totalChunks: 3,
      headingChunks: [],
      storage: failing,
      url: "https://example.com/fail",
    });
    // Must not throw; rejection is swallowed best-effort.
    expect(() => store.seek(1)).not.toThrow();
    expect(() => store.next()).not.toThrow();
    expect(store.getPosition().chunkIndex).toBe(2);
  });
});

/**
 * Ticket 0022 — char-weighted progress model.
 *
 * percent-complete is now Σ chars of completed chunks / total chars (chunks
 * before the current one), replacing the old `chunkIndex / (totalChunks-1)`
 * model from 0011. Large paragraphs move the thumb further than small ones.
 */
describe("createPositionStore char-weighted progress (ticket 0022)", () => {
  it("weights percent by chunk char length", () => {
    // Chunk 0 holds 100 of 104 chars → completing it lands at 96.2%.
    const store = createPositionStore({
      totalChunks: 5,
      headingChunks: [],
      chunkCharLengths: [100, 1, 1, 1, 1],
    });
    expect(store.getPosition().percentComplete).toBe(0);
    store.next();
    expect(store.getPosition().percentComplete).toBe(96.2);
    store.next();
    expect(store.getPosition().percentComplete).toBe(97.1);
  });

  it("keeps 0% at the first chunk and the whole article at the last", () => {
    const store = createPositionStore({
      totalChunks: 3,
      headingChunks: [],
      chunkCharLengths: [10, 30, 60],
    });
    expect(store.getPosition().percentComplete).toBe(0);
    store.seek(1);
    expect(store.getPosition().percentComplete).toBe(10);
    store.seek(2);
    expect(store.getPosition().percentComplete).toBe(40);
  });

  it("defaults missing entries to one char", () => {
    // chunkCharLengths shorter than totalChunks: missing entries count 1
    // (total = 5 + 1 + 1 = 7).
    const store = createPositionStore({
      totalChunks: 3,
      headingChunks: [],
      chunkCharLengths: [5],
    });
    store.seek(1);
    expect(store.getPosition().percentComplete).toBe(71.4); // 5/7
    store.seek(2);
    expect(store.getPosition().percentComplete).toBe(85.7); // 6/7
  });

  it("percentAt reports the char-weighted percent for any chunk", () => {
    const store = createPositionStore({
      totalChunks: 4,
      headingChunks: [],
      chunkCharLengths: [5, 5, 5, 5],
    });
    expect(store.percentAt(0)).toBe(0);
    expect(store.percentAt(1)).toBe(25);
    expect(store.percentAt(2)).toBe(50);
    expect(store.percentAt(3)).toBe(75);
  });

  it("seekToPercent moves to the chunk containing that percent position", () => {
    // Chunks of 10 chars in 50 total: chunk 1 spans (20%, 40%], chunk 2 (40%, 60%].
    const store = createPositionStore({
      totalChunks: 5,
      headingChunks: [],
      chunkCharLengths: [10, 10, 10, 10, 10],
    });
    store.seekToPercent(25);
    expect(store.getPosition().chunkIndex).toBe(1);
    store.seekToPercent(50);
    expect(store.getPosition().chunkIndex).toBe(2);
    store.seekToPercent(0);
    expect(store.getPosition().chunkIndex).toBe(0);
    store.seekToPercent(100);
    expect(store.getPosition().chunkIndex).toBe(4);
  });

  it("seekToPercent handles a boundary exactly at a chunk start", () => {
    // Chunk 1 starts exactly at 20% (cum 20/100).
    const store = createPositionStore({
      totalChunks: 5,
      headingChunks: [],
      chunkCharLengths: [20, 20, 20, 20, 20],
    });
    store.seekToPercent(20);
    expect(store.getPosition().chunkIndex).toBe(1);
  });

  it("seekToPercent clamps out-of-range percents", () => {
    const store = createPositionStore({
      totalChunks: 4,
      headingChunks: [],
      chunkCharLengths: [1, 1, 1, 1],
    });
    store.seekToPercent(-5);
    expect(store.getPosition().chunkIndex).toBe(0);
    store.seekToPercent(999);
    expect(store.getPosition().chunkIndex).toBe(3);
  });

  it("stays at 0% with an empty article", () => {
    const store = createPositionStore({ totalChunks: 0, headingChunks: [] });
    expect(store.getPosition()).toEqual({
      chunkIndex: 0,
      headingIndex: null,
      percentComplete: 0,
    });
    store.seekToPercent(50);
    expect(store.getPosition().chunkIndex).toBe(0);
  });
});
