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

  it("computes percent-complete rounded to one decimal", () => {
    const store = createPositionStore({ totalChunks: 5, headingChunks: [] });
    store.seek(2);
    expect(store.getPosition().percentComplete).toBe(50);
    store.next();
    expect(store.getPosition().percentComplete).toBe(75);
    store.previous();
    expect(store.getPosition().percentComplete).toBe(50);
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
    expect(second.getPosition().percentComplete).toBe(80);
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
    expect(store.getPosition().percentComplete).toBeCloseTo(66.7, 1);
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
