// Browser cache for fetched comments, categories, and post/ad lists.
// Uses IndexedDB (megabytes, stays on this device, never sent to the server) rather than cookies,
// which hold only ~4 KB and are sent with every request. Entries expire after 24 hours and are
// cleared on logout, because they contain customers' comments.
const DB = "comment-pulse";
const STORE = "kv";
export const TTL_MS = 24 * 3600 * 1000;

let ns = "anon";
let dbp: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, { at: number; value: unknown }>();

export function setCacheNamespace(userId: string) {
  ns = userId || "anon";
}

function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return (dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return db().then((d) => new Promise((resolve) => {
    if (!d) return resolve(null);
    try {
      const r = run(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

export async function cacheGet<T>(key: string): Promise<{ at: number; value: T } | null> {
  const k = `${ns}:${key}`;
  const hit = (await tx<{ at: number; value: T }>("readonly", (s) => s.get(k))) || (memory.get(k) as any) || null;
  if (!hit || Date.now() - hit.at > TTL_MS) return null;
  return hit;
}

export async function cacheSet(key: string, value: unknown) {
  const k = `${ns}:${key}`;
  const entry = { at: Date.now(), value };
  memory.set(k, entry);
  await tx("readwrite", (s) => s.put(entry, k));
}

export async function cacheClear() {
  memory.clear();
  await tx("readwrite", (s) => s.clear());
}

export const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
};
