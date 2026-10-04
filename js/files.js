// ShowCrew GearVault — attachment blobs (photos / receipts) in IndexedDB so large files work offline.
const DB = 'showcrew-gearvault', STORE = 'files';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), st = t.objectStore(STORE); let out;
    const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('IndexedDB transaction aborted'));
  });
}
// Store {id, blob, thumb}. Blobs are stored as ArrayBuffer+type for maximum Safari compatibility.
export async function put(id, blob, thumb = null) {
  const rec = { id, type: blob.type, buf: await blob.arrayBuffer(), thumbType: thumb ? thumb.type : '', thumbBuf: thumb ? await thumb.arrayBuffer() : null };
  return tx('readwrite', st => st.put(rec));
}
export async function get(id) {
  const r = await tx('readonly', st => st.get(id)); if (!r) return null;
  return { blob: new Blob([r.buf], { type: r.type }), thumb: r.thumbBuf ? new Blob([r.thumbBuf], { type: r.thumbType }) : null };
}
export const del = id => tx('readwrite', st => st.delete(id));
export const keys = () => tx('readonly', st => st.getAllKeys());
export const clear = () => tx('readwrite', st => st.clear());

/** Small JPEG thumbnail for images (null for PDFs or undecodable images). */
export async function makeThumb(blob, max = 320) {
  if (!/^image\//.test(blob.type)) return null;
  try {
    let src, w, h;
    if (self.createImageBitmap) { src = await createImageBitmap(blob); w = src.width; h = src.height; }
    else { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(blob); }); w = src.naturalWidth; h = src.naturalHeight; }
    const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.78));
  } catch { return null; }
}
export const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
export function dataURLToBlob(u) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u || ''); if (!m) throw new Error('Bad file data in backup');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: m[1] || 'application/octet-stream' });
}
