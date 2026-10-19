// IndexedDB access layer. All persistence goes through here so storage can evolve
// (e.g. a sync engine) without rewriting UI components.
import type { StoreMap, StoreName } from "./types";

export const DB_NAME = "miki";
/** Bump when stores or indexes change; add a step to `MIGRATIONS`. Never drop user data. */
export const DB_VERSION = 1;

interface StoreSpec {
  name: StoreName;
  keyPath: string;
  indexes?: string[];
}

const STORES: StoreSpec[] = [
  { name: "projects", keyPath: "id" },
  { name: "documents", keyPath: "id", indexes: ["projectId"] },
  { name: "snapshots", keyPath: "id", indexes: ["documentId", "projectId"] },
  { name: "notes", keyPath: "id", indexes: ["projectId"] },
  { name: "recordings", keyPath: "id", indexes: ["projectId"] },
  { name: "audio", keyPath: "id" },
  { name: "transcripts", keyPath: "id", indexes: ["projectId", "recordingId"] },
  { name: "boards", keyPath: "id", indexes: ["projectId"] },
  { name: "sections", keyPath: "id", indexes: ["projectId", "boardId"] },
  { name: "cards", keyPath: "id", indexes: ["projectId", "boardId"] },
  { name: "links", keyPath: "id", indexes: ["projectId"] },
  { name: "references", keyPath: "id", indexes: ["projectId"] },
  { name: "processes", keyPath: "id", indexes: ["projectId"] },
  { name: "steps", keyPath: "id", indexes: ["projectId", "processId"] },
  { name: "decisions", keyPath: "id", indexes: ["projectId"] },
  { name: "templates", keyPath: "id" },
  { name: "prefs", keyPath: "key" },
];

export const ALL_STORES = STORES.map((s) => s.name);

/** Per-version upgrade steps. Version 1 creates everything. */
const MIGRATIONS: Record<number, (db: IDBDatabase, tx: IDBTransaction) => void> = {
  1: (db) => {
    for (const spec of STORES) {
      if (db.objectStoreNames.contains(spec.name)) continue;
      const store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
      for (const idx of spec.indexes ?? []) store.createIndex(idx, idx, { unique: false });
    }
  },
};

export class StorageError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new StorageError("This browser doesn't provide IndexedDB, so Miki can't store your work."));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new StorageError("The browser refused to open local storage.", err));
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction!;
      for (let v = event.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v]?.(db, tx);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        window.dispatchEvent(new CustomEvent("miki:db-versionchange"));
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(new StorageError("Miki couldn't open its local database. Private browsing or storage settings may be blocking it.", req.error));
    };
    req.onblocked = () => {
      window.dispatchEvent(new CustomEvent("miki:db-blocked"));
    };
  });
  return dbPromise;
}

/* ------------------------------------------------------------------ change bus */

type Listener = (stores: Set<StoreName>) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
try {
  channel = typeof BroadcastChannel !== "undefined" && typeof window !== "undefined" ? new BroadcastChannel("miki-changes") : null;
  channel?.addEventListener("message", (e) => {
    const stores = new Set<StoreName>(e.data as StoreName[]);
    listeners.forEach((l) => l(stores));
  });
} catch {
  channel = null;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(stores: Iterable<StoreName>) {
  const set = new Set(stores);
  listeners.forEach((l) => l(set));
  try {
    channel?.postMessage([...set]);
  } catch {
    /* other tabs will refresh on focus */
  }
}

/* ------------------------------------------------------------------ diagnostics */

/** When set (Settings → Diagnostics), writes to these stores fail. Used to verify recovery paths. */
export const diagnostics = { failWritesTo: new Set<StoreName>() };

/* ------------------------------------------------------------------ primitives */

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface Tx {
  get<S extends StoreName>(store: S, id: string): Promise<StoreMap[S] | undefined>;
  getAll<S extends StoreName>(store: S): Promise<StoreMap[S][]>;
  byIndex<S extends StoreName>(store: S, index: string, value: IDBValidKey): Promise<StoreMap[S][]>;
  put<S extends StoreName>(store: S, value: StoreMap[S]): void;
  delete(store: StoreName, id: string): void;
}

/**
 * Run `fn` inside a single IndexedDB transaction. Resolves after the transaction commits,
 * so callers never report success before data is durable.
 */
export async function transact<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: Tx) => Promise<T> | T): Promise<T> {
  if (mode === "readwrite") {
    const failing = stores.find((s) => diagnostics.failWritesTo.has(s));
    if (failing) throw new StorageError(`Simulated write failure for "${failing}" (Settings → Diagnostics).`);
  }
  const db = await openDB();
  let tx: IDBTransaction;
  try {
    tx = db.transaction(stores, mode);
  } catch (err) {
    throw new StorageError("Couldn't start a storage transaction.", err);
  }
  const touched = new Set<StoreName>();
  const api: Tx = {
    get: (store, id) => reqToPromise(tx.objectStore(store).get(id)),
    getAll: (store) => reqToPromise(tx.objectStore(store).getAll()),
    byIndex: (store, index, value) => reqToPromise(tx.objectStore(store).index(index).getAll(value)),
    put: (store, value) => {
      touched.add(store);
      tx.objectStore(store).put(value);
    },
    delete: (store, id) => {
      touched.add(store);
      tx.objectStore(store).delete(id);
    },
  };
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new StorageError(tx.error?.name === "QuotaExceededError" ? "Your device is out of storage space for Miki." : "A storage write failed.", tx.error));
    tx.onabort = () => reject(new StorageError(tx.error?.name === "QuotaExceededError" ? "Your device is out of storage space for Miki." : "A storage transaction was aborted.", tx.error));
  });
  let result: T;
  try {
    result = await fn(api);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    await done.catch(() => undefined);
    throw err;
  }
  await done;
  if (touched.size) notify(touched);
  return result;
}

export const db = {
  get<S extends StoreName>(store: S, id: string) {
    return transact([store], "readonly", (tx) => tx.get(store, id));
  },
  getAll<S extends StoreName>(store: S) {
    return transact([store], "readonly", (tx) => tx.getAll(store));
  },
  byIndex<S extends StoreName>(store: S, index: string, value: IDBValidKey) {
    return transact([store], "readonly", (tx) => tx.byIndex(store, index, value));
  },
  put<S extends StoreName>(store: S, value: StoreMap[S]) {
    return transact([store], "readwrite", (tx) => tx.put(store, value)).then(() => value);
  },
  putMany<S extends StoreName>(store: S, values: StoreMap[S][]) {
    return transact([store], "readwrite", (tx) => values.forEach((v) => tx.put(store, v)));
  },
  delete(store: StoreName, id: string) {
    return transact([store], "readwrite", (tx) => tx.delete(store, id));
  },
};

/** Ask the browser not to evict Miki's data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* unsupported */
  }
  return false;
}

export async function storageStatus(): Promise<{ persisted: boolean | null; usage: number | null; quota: number | null }> {
  let persisted: boolean | null = null;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      usage = e.usage ?? null;
      quota = e.quota ?? null;
    }
  } catch {
    /* unsupported */
  }
  return { persisted, usage, quota };
}

export async function deleteEverything(): Promise<void> {
  await transact(ALL_STORES, "readwrite", async (tx) => {
    for (const store of ALL_STORES) {
      const rows = await tx.getAll(store);
      for (const row of rows as { id?: string; key?: string }[]) tx.delete(store, (row.id ?? row.key) as string);
    }
  });
}
