// ShowCrew GearVault v2 — Supabase data layer: load everything for the signed-in user, push changes (diff-based), storage helpers.
import * as M from './cloudmap.js';

const PAGE = 1000, CHUNK = 200;
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const fail = (what, error) => { const e = new Error(`${what}: ${error.message || error}`); e.cause = error; throw e; };

export function createCloud(sb, user, bucket = 'gear-files') {
  let snap = null, running = null, again = false;

  async function fetchAll(table) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select('*').range(from, from + PAGE - 1);
      if (error) fail(`Loading ${table}`, error);
      rows.push(...(data || [])); if (!data || data.length < PAGE) break;
    }
    return rows;
  }
  async function loadAll() {
    const R = {}; await Promise.all(M.TABLES.map(async t => { R[t] = await fetchAll(t); }));
    const S = M.stateFromRows(R);
    snap = M.snapshotOf(M.rowsFromState(S, user.id));
    if (!R.settings.length) snap.settings.clear(); // first run: make sure a settings row gets written
    if (!R.categories.length) snap.categories.clear();
    return S;
  }
  async function pushOnce(S) {
    if (!snap) throw new Error('Not loaded yet');
    const rows = M.rowsFromState(S, user.id), d = M.diff(snap, rows);
    if (!d.count) return 0;
    for (const t of M.UPSERT_ORDER) for (const part of chunks(d.up[t], CHUNK)) {
      const { error } = await sb.from(t).upsert(part, { onConflict: M.CONFLICT[t] });
      if (error) fail(`Saving ${t}`, error);
      for (const r of part) snap[t].set(M.keyOf(t, r), JSON.stringify(r));
    }
    for (const t of M.DELETE_ORDER) {
      if (!d.del[t].length) continue;
      const cols = M.keyCols(t), groups = new Map();
      for (const r of d.del[t]) { const g = cols.length > 1 ? r[cols[0]] : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
      for (const [g, rs] of groups) for (const part of chunks(rs, CHUNK)) {
        let q = sb.from(t).delete();
        if (cols.length > 1) q = q.eq(cols[0], g);
        if (t === 'categories') q = q.eq('owner_id', user.id);
        const { error } = await q.in(cols[cols.length - 1], part.map(r => r[cols[cols.length - 1]]));
        if (error) fail(`Deleting from ${t}`, error);
        if (t === 'attachments') await removeFiles(part.flatMap(r => [r.path, r.thumb_path]).filter(Boolean));
        for (const r of part) snap[t].delete(M.keyOf(t, r));
      }
    }
    return d.count;
  }
  /** Push local changes. getS() returns the current state. Calls are serialized; a call made while one is running triggers one more pass. */
  function sync(getS) {
    if (running) { again = true; return running; }
    running = (async () => {
      let n = 0;
      try { do { again = false; n += await pushOnce(getS()); } while (again); return n; }
      finally { running = null; }
    })();
    return running;
  }
  const pending = S => (snap ? M.diff(snap, M.rowsFromState(S, user.id)).count : 0);

  // ---------- storage ----------
  const store = () => sb.storage.from(bucket);
  async function upload(path, blob) {
    const { error } = await store().upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: true, cacheControl: '3600' });
    if (error) fail('Uploading file', error);
  }
  async function download(path) {
    const { data, error } = await store().download(path);
    if (error) fail('Downloading file', error); return data;
  }
  async function removeFiles(paths) { if (paths.length) { const { error } = await store().remove(paths); if (error) console.warn('GearVault: could not remove files', error); } }
  async function signedUrl(path, opts) {
    const { data, error } = await store().createSignedUrl(path, 600, opts);
    if (error) fail('Signing file URL', error); return data.signedUrl;
  }
  return { user, loadAll, sync, pending, upload, download, removeFiles, signedUrl, get ready() { return !!snap; } };
}
