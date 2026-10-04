// ShowCrew GearVault v2 — offline read cache in IndexedDB (last synced state + photo/receipt blobs). Cleared on sign-out.
const DB = 'showcrew-gearvault-cloud';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { for (const s of ['kv', 'blobs']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), st = t.objectStore(store); let out;
    const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('IndexedDB aborted'));
  });
}
export const kvGet = k => tx('kv', 'readonly', s => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
// Blobs are stored as {type, buf} for Safari compatibility.
export async function blobPut(k, blob) { const buf = await blob.arrayBuffer(); return tx('blobs', 'readwrite', s => s.put({ type: blob.type, buf }, k)); }
export async function blobGet(k) { const r = await tx('blobs', 'readonly', s => s.get(k)).catch(() => null); return r ? new Blob([r.buf], { type: r.type }) : null; }
export const blobDel = k => tx('blobs', 'readwrite', s => s.delete(k));
export async function clearAll() { await tx('kv', 'readwrite', s => s.clear()); await tx('blobs', 'readwrite', s => s.clear()); }
