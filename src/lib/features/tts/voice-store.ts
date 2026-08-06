/**
 * Ticket 0006 — IndexedDB voice-model cache for the WASM Piper adapter.
 *
 * Piper voice models are ~30–60MB; downloading on every utterance is
 * unacceptable. The cache policy is: on first use, download the model and store
 * the Blob keyed by `voiceUri`; on subsequent loads, read the Blob back from
 * IndexedDB with NO re-download. The adapter (controller context) calls
 * {@link ensureVoiceModel} before synthesis; the offscreen synthesis host calls
 * {@link getVoiceModel} to read the cached model the adapter already ensured.
 *
 * Node-safe to import: every `indexedDB` / `fetch` access goes through a
 * gated getter, so the module loads in the vitest (node) environment without a
 * DOM. Operations reject when the global is absent rather than throwing on
 * import. The promise wrapper uses the standard IDB request/event API, so a
 * faithful fake IndexedDB exercises the real caching logic in tests.
 */

/** A cached voice model record stored keyed by `voiceUri`. */
interface VoiceModelRecord {
  readonly blob: Blob;
  readonly size: number;
  readonly url: string;
  readonly storedAt: number;
}

const DB_NAME = "openwebtts-piper";
const STORE_NAME = "voice-models";
const DB_VERSION = 1;

/** The narrow `IDBFactory` / `IDBDatabase` / request surface this module uses. */
interface IDBReq {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}
interface IDBStore {
  get(key: string): IDBReq;
  put(value: unknown, key: string): IDBReq;
}
interface IDBDatabaseSurface {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): IDBStore;
  transaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ): { objectStore(name: string): IDBStore };
}
interface IDBFactorySurface {
  open(name: string, version: number): IDBReq;
}

function getIDB(): IDBFactorySurface | undefined {
  const g = globalThis as Record<string, unknown>;
  return typeof g.indexedDB === "object" && g.indexedDB !== null
    ? (g.indexedDB as IDBFactorySurface)
    : undefined;
}

type FetchLike = (url: string) => Promise<Response>;

function getFetch(): FetchLike | undefined {
  const g = globalThis as Record<string, unknown>;
  return typeof g.fetch === "function" ? (g.fetch as FetchLike) : undefined;
}

function openDB(): Promise<IDBDatabaseSurface> {
  const idb = getIDB();
  if (!idb) return Promise.reject(new Error("IndexedDB unavailable"));
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabaseSurface>();
  const req = idb.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result as IDBDatabaseSurface;
    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  };
  req.onsuccess = () => resolve(req.result as IDBDatabaseSurface);
  req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  return promise;
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBStore) => Promise<T>): Promise<T> {
  return openDB().then((db) => run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
}

function reqAsPromise<T>(req: IDBReq): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  req.onsuccess = () => resolve(req.result as T);
  req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  return promise;
}

/**
 * Reads a cached voice model Blob by `voiceUri`, or `undefined` if not cached.
 * Rejects when IndexedDB is unavailable.
 */
export async function getVoiceModel(voiceUri: string): Promise<Blob | undefined> {
  const rec = await withStore("readonly", (store) =>
    reqAsPromise<VoiceModelRecord | undefined>(store.get(voiceUri)),
  );
  return rec?.blob;
}

/** Stores (or replaces) a voice model Blob keyed by `voiceUri`. */
export async function putVoiceModel(voiceUri: string, blob: Blob, url: string): Promise<void> {
  const record: VoiceModelRecord = { blob, size: blob.size, url, storedAt: Date.now() };
  await withStore("readwrite", (store) => reqAsPromise(store.put(record, voiceUri)));
}

/**
 * Returns the cached model Blob for `voiceUri`, downloading it from `url` and
 * caching it on first use. Subsequent calls with the same `voiceUri` read from
 * IndexedDB and do NOT re-download. Rejects when IndexedDB or `fetch` is
 * unavailable, or when the download fails.
 */
export async function ensureVoiceModel(voiceUri: string, url: string): Promise<Blob> {
  const existing = await getVoiceModel(voiceUri);
  if (existing) return existing;

  const fetchFn = getFetch();
  if (!fetchFn) throw new Error("fetch unavailable");
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`voice model download failed: ${res.status}`);
  const blob = await res.blob();
  await putVoiceModel(voiceUri, blob, url);
  return blob;
}
