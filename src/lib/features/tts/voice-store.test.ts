import { ensureVoiceModel, getVoiceModel, putVoiceModel } from "$lib/features/tts/voice-store";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * Ticket 0006 — IndexedDB voice-model cache.
 *
 * The cache policy (download-on-first-use, read-on-subsequent, no re-download)
 * is the load-bearing behavior. These tests exercise the REAL voice-store
 * against a FAKE IndexedDB (the storage layer is mocked; the caching logic is
 * not) plus a fake `fetch`, asserting the observable contract rather than mock
 * calls.
 */

const STORE_NAME = "voice-models";

/** A minimal faithful fake of the IndexedDB request/event API surface used. */
class FakeReq<T> {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  onsuccess: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onupgradeneeded: ((e: Event) => void) | null = null;

  fire(result: T, error: DOMException | null = null): void {
    this.result = result;
    this.error = error;
    queueMicrotask(() => {
      if (error) this.onerror?.({} as Event);
      else this.onsuccess?.({} as Event);
    });
  }
}

class FakeStore {
  private data = new Map<string, unknown>();

  get(key: string): FakeReq<unknown> {
    const r = new FakeReq<unknown>();
    r.fire(this.data.get(key));
    return r;
  }

  put(value: unknown, key: string): FakeReq<unknown> {
    this.data.set(key, value);
    const r = new FakeReq<unknown>();
    r.fire(undefined);
    return r;
  }
}

class FakeDB {
  private stores = new Map<string, FakeStore>();

  objectStoreNames = { contains: (n: string): boolean => this.stores.has(n) };

  createObjectStore(n: string): FakeStore {
    const s = new FakeStore();
    this.stores.set(n, s);
    return s;
  }

  transaction(): { objectStore(n: string): FakeStore } {
    return { objectStore: (n) => this.stores.get(n)! };
  }
}

function createFakeIDB(db: FakeDB): {
  open(name: string, version: number): FakeReq<FakeDB>;
} {
  return {
    open(_name: string, _version: number): FakeReq<FakeDB> {
      const r = new FakeReq<FakeDB>();
      queueMicrotask(() => {
        // `req.result` is the db during onupgradeneeded (version change) and onsuccess.
        r.result = db;
        if (!db.objectStoreNames.contains(STORE_NAME)) r.onupgradeneeded?.({} as Event);
        r.onsuccess?.({} as Event);
      });
      return r;
    },
  };
}

interface Saved {
  indexedDB?: unknown;
  fetch?: unknown;
}
const saved: Saved = {};
let fetchCalls = 0;

function install(db: FakeDB, fetchImpl?: typeof fetch): void {
  const g = globalThis as Record<string, unknown>;
  saved.indexedDB = g.indexedDB;
  saved.fetch = g.fetch;
  g.indexedDB = createFakeIDB(db);
  g.fetch =
    fetchImpl ??
    (async (_url: string | URL | Request) => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/octet-stream" }),
      } as Response;
    });
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if ("indexedDB" in saved) g.indexedDB = saved.indexedDB;
  else delete g.indexedDB;
  if ("fetch" in saved) g.fetch = saved.fetch;
  else delete g.fetch;
  fetchCalls = 0;
});

describe("voice model store (ticket 0006)", () => {
  it("getVoiceModel returns undefined when nothing is cached", async () => {
    install(new FakeDB());
    expect(await getVoiceModel("voice:en_US-amy-medium")).toBeUndefined();
  });

  it("downloads and caches a model on first ensure, then reads from cache (no re-download)", async () => {
    install(new FakeDB());
    const url = "https://models.openwebtts/en_US-amy-medium.onnx";

    const first = await ensureVoiceModel("voice:en_US-amy-medium", url);
    expect(fetchCalls).toBe(1);
    expect(first.size).toBe(4);

    const second = await ensureVoiceModel("voice:en_US-amy-medium", url);
    expect(fetchCalls).toBe(1); // no re-download
    expect(second.size).toBe(4);
  });

  it("putVoiceModel then getVoiceModel round-trips the blob", async () => {
    install(new FakeDB());
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: "application/octet-stream" });

    await putVoiceModel("voice:x", blob, "https://models/x.onnx");
    const got = await getVoiceModel("voice:x");

    expect(got).toBeInstanceOf(Blob);
    expect(got?.size).toBe(3);
  });

  it("ensureVoiceModel throws when fetch fails", async () => {
    install(
      new FakeDB(),
      async () => ({ ok: false, status: 404, blob: async () => new Blob() }) as Response,
    );
    await expect(ensureVoiceModel("voice:bad", "https://models/missing.onnx")).rejects.toThrow(
      /404/,
    );
  });

  it("throws when IndexedDB is unavailable (node without it)", async () => {
    const g = globalThis as Record<string, unknown>;
    delete g.indexedDB;
    await expect(getVoiceModel("voice:none")).rejects.toThrow();
  });
});
