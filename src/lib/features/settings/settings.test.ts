/**
 * Ticket 0015 — tests for the reader settings store.
 */

import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  type SettingsStore,
  type StorageArea,
} from "./settings.js";

function createMemoryStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    async get(key: string): Promise<unknown> {
      return data.get(key);
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
    },
  };
}

async function waitForStoreInit(store: SettingsStore): Promise<void> {
  await store.loaded;
}

describe("createSettingsStore", () => {
  let storage: StorageArea;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("starts with defaults", async () => {
    const store = createSettingsStore(storage);
    await waitForStoreInit(store);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists and reloads every field", async () => {
    const store = createSettingsStore(storage);
    await waitForStoreInit(store);

    await store.set({
      voiceUri: "voice://en-us",
      rate: 1.25,
      pitch: 1.1,
      volume: 0.8,
      highlightMode: "sentence",
    });

    const reloaded = createSettingsStore(storage);
    await waitForStoreInit(reloaded);

    expect(reloaded.get()).toEqual({
      voiceUri: "voice://en-us",
      rate: 1.25,
      pitch: 1.1,
      volume: 0.8,
      highlightMode: "sentence",
    });
  });

  it("falls back to default for invalid highlight mode", async () => {
    await storage.set("reader-settings", { highlightMode: "invalid" });
    const store = createSettingsStore(storage);
    await waitForStoreInit(store);
    expect(store.get().highlightMode).toBe("paragraph");
  });

  it("emits change events", async () => {
    const store = createSettingsStore(storage);
    await waitForStoreInit(store);
    const changes: ReturnType<typeof store.get>[] = [];
    const dispose = store.onChange((s) => changes.push(s));

    await store.set({ rate: 1.5 });
    await store.set({ highlightMode: "off" });

    expect(changes).toHaveLength(2);
    expect(changes[0].rate).toBe(1.5);
    expect(changes[1].highlightMode).toBe("off");

    dispose();
  });

  it("reset restores defaults", async () => {
    const store = createSettingsStore(storage);
    await waitForStoreInit(store);
    await store.set({ rate: 2, voiceUri: "x" });
    await store.reset();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });
});
