// ShowCrew GearVault v2 — pure mapping between the in-app state and Supabase table rows + diffing (no DOM, no network).
// Tested by tools/test-carnet.mjs.
import * as Store from './store.js';

export const TABLES = ['settings', 'categories', 'items', 'kits', 'trips', 'attachments', 'kit_items', 'trip_kits', 'trip_items'];
export const UPSERT_ORDER = TABLES; // parents before children
export const DELETE_ORDER = ['trip_items', 'trip_kits', 'kit_items', 'attachments', 'trips', 'kits', 'items', 'categories'];
export const CONFLICT = { settings: 'owner_id', categories: 'owner_id,name', items: 'id', kits: 'id', trips: 'id', attachments: 'id', kit_items: 'kit_id,item_id', trip_kits: 'trip_id,kit_id', trip_items: 'trip_id,item_id' };
const KEYCOLS = { settings: ['owner_id'], categories: ['name'], items: ['id'], kits: ['id'], trips: ['id'], attachments: ['id'], kit_items: ['kit_id', 'item_id'], trip_kits: ['trip_id', 'kit_id'], trip_items: ['trip_id', 'item_id'] };
export const keyOf = (t, r) => KEYCOLS[t].map(c => r[c]).join('|');
export const keyCols = t => KEYCOLS[t];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nz = v => (v === '' || v == null ? null : v);
const num = v => (v == null || v === '' ? null : Number(v));
const iso = ms => new Date(Number.isFinite(+ms) && +ms > 0 ? +ms : Date.now()).toISOString();
const ms = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : Date.now(); };
export const isImage = type => /^image\//.test(type || '');
export const filePath = (uid, itemId, attId) => `${uid}/${itemId}/${attId}`;
export const thumbPath = p => `${p}.thumb.jpg`;

/** State → rows, keyed per table: { table: Map(key → row) }. owner_id is always the signed-in user. */
export function rowsFromState(S, uid) {
  const out = Object.fromEntries(TABLES.map(t => [t, new Map()]));
  const put = (t, r) => out[t].set(keyOf(t, r), r);
  const st = S.settings;
  put('settings', { owner_id: uid, currency: st.currency, weight_unit: st.weightUnit, holder: st.holder || '' });
  st.categories.forEach((name, position) => put('categories', { owner_id: uid, name, position }));
  const itemIds = new Set(S.items.map(i => i.id)), kitIds = new Set(S.kits.map(k => k.id));
  for (const i of S.items) {
    put('items', {
      id: i.id, owner_id: uid, name: i.name, category: i.category, make: i.make, model: i.model, serial: i.serial, qty: i.qty, status: i.status,
      purchase_date: nz(i.purchaseDate), price: num(i.price), currency: i.currency, current_value: num(i.currentValue), vendor: i.vendor, origin: i.origin,
      weight: num(i.weight), weight_unit: i.weightUnit, notes: i.notes, tags: i.tags.slice(),
    });
    for (const a of i.atts) {
      put('attachments', { id: a.id, owner_id: uid, item_id: i.id, name: a.name, mime: a.type || '', size: a.size || 0, kind: a.kind,
        path: a.path || filePath(uid, i.id, a.id), thumb_path: a.thumb ?? null, added_at: iso(a.added) });
    }
  }
  for (const k of S.kits) {
    put('kits', { id: k.id, owner_id: uid, name: k.name, type: k.type, notes: k.notes || '' });
    k.itemIds.filter(id => itemIds.has(id)).forEach((item_id, position) => put('kit_items', { owner_id: uid, kit_id: k.id, item_id, position }));
  }
  for (const t of S.trips) {
    put('trips', { id: t.id, owner_id: uid, name: t.name, destinations: t.destinations || '', depart: nz(t.depart), return_date: nz(t.ret), carnet_no: t.carnetNo || '',
      holder: t.holder || '', purpose: t.purpose || '', currency: t.currency, weight_unit: t.weightUnit, serial_in_desc: !!t.serialInDesc, notes: t.notes || '' });
    t.kitIds.filter(id => kitIds.has(id)).forEach((kit_id, position) => put('trip_kits', { owner_id: uid, trip_id: t.id, kit_id, position }));
    const seen = new Set();
    t.itemIds.filter(id => itemIds.has(id)).forEach((item_id, position) => { seen.add(item_id); put('trip_items', { owner_id: uid, trip_id: t.id, item_id, mode: 'include', position }); });
    (t.excluded || []).filter(id => itemIds.has(id) && !seen.has(id)).forEach((item_id, position) => put('trip_items', { owner_id: uid, trip_id: t.id, item_id, mode: 'exclude', position }));
  }
  return out;
}

/** Rows (arrays straight from PostgREST) → sanitized app state. */
export function stateFromRows(R) {
  const settings = Store.defaultSettings();
  const s = (R.settings || [])[0];
  if (s) Object.assign(settings, { currency: s.currency || 'USD', weightUnit: s.weight_unit === 'lb' ? 'lb' : 'kg', holder: s.holder || '' });
  const cats = (R.categories || []).slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map(c => c.name);
  if (cats.length) settings.categories = cats;
  const by = (rows, k) => { const m = new Map(); for (const r of rows || []) { if (!m.has(r[k])) m.set(r[k], []); m.get(r[k]).push(r); } return m; };
  const attBy = by(R.attachments, 'item_id'), kiBy = by(R.kit_items, 'kit_id'), tkBy = by(R.trip_kits, 'trip_id'), tiBy = by(R.trip_items, 'trip_id');
  const pos = (a, b) => a.position - b.position;
  const items = (R.items || []).map(r => Store.sanitizeItem({
    id: r.id, name: r.name, category: r.category, make: r.make, model: r.model, serial: r.serial, qty: r.qty, status: r.status,
    purchaseDate: r.purchase_date || '', price: num(r.price), currency: r.currency, currentValue: num(r.current_value), vendor: r.vendor, origin: r.origin,
    weight: num(r.weight), weightUnit: r.weight_unit, notes: r.notes, tags: r.tags || [], created: ms(r.created_at), updated: ms(r.updated_at),
    atts: (attBy.get(r.id) || []).sort((a, b) => ms(a.added_at) - ms(b.added_at)).map(a => ({ id: a.id, name: a.name, type: a.mime, size: Number(a.size) || 0, kind: a.kind, added: ms(a.added_at), path: a.path, thumb: a.thumb_path })),
  }, settings));
  const kits = (R.kits || []).map(r => ({ id: r.id, name: r.name, type: r.type, notes: r.notes || '', itemIds: (kiBy.get(r.id) || []).sort(pos).map(x => x.item_id), created: ms(r.created_at), updated: ms(r.updated_at) }));
  const trips = (R.trips || []).map(r => {
    const ti = (tiBy.get(r.id) || []).sort(pos);
    return { ...Store.makeTrip(settings), id: r.id, name: r.name, destinations: r.destinations || '', depart: r.depart || '', ret: r.return_date || '', carnetNo: r.carnet_no || '',
      holder: r.holder || '', purpose: r.purpose || '', currency: r.currency || 'USD', weightUnit: r.weight_unit === 'lb' ? 'lb' : 'kg', serialInDesc: !!r.serial_in_desc, notes: r.notes || '',
      kitIds: (tkBy.get(r.id) || []).sort(pos).map(x => x.kit_id), itemIds: ti.filter(x => x.mode !== 'exclude').map(x => x.item_id), excluded: ti.filter(x => x.mode === 'exclude').map(x => x.item_id),
      created: ms(r.created_at), updated: ms(r.updated_at) };
  });
  return { v: 2, items, kits, trips, settings };
}

/** Snapshot (key → JSON) of rows, used to detect what changed since the last successful sync. */
export function snapshotOf(rows) {
  const snap = {}; for (const t of TABLES) { snap[t] = new Map(); for (const [k, r] of rows[t]) snap[t].set(k, JSON.stringify(r)); } return snap;
}
export function diff(snap, rows) {
  const up = {}, del = {};
  for (const t of TABLES) {
    up[t] = []; del[t] = [];
    for (const [k, r] of rows[t]) if (snap[t].get(k) !== JSON.stringify(r)) up[t].push(r);
    for (const k of snap[t].keys()) if (!rows[t].has(k)) del[t].push(JSON.parse(snap[t].get(k)));
  }
  return { up, del, count: TABLES.reduce((a, t) => a + up[t].length + del[t].length, 0) };
}

// ---------- ids ----------
export async function uuidFrom(text) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80; // version-5 style layout
  const x = [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
/** Give every non-UUID id (v1 data, old backups) a deterministic UUID derived from (uid, old id) so re-uploading never duplicates.
 *  Mutates S; returns Map(old → new). Attachment paths are reset to the signed-in user's folder. */
export async function remapIds(S, uid) {
  const map = new Map();
  const m = async id => { if (UUID_RE.test(id)) return id; if (!map.has(id)) map.set(id, await uuidFrom(`${uid}:${id}`)); return map.get(id); };
  const ma = arr => Promise.all((arr || []).map(m));
  for (const i of S.items) {
    i.id = await m(i.id);
    for (const a of i.atts) { a.id = await m(a.id); a.path = filePath(uid, i.id, a.id); a.thumb = isImage(a.type) ? thumbPath(a.path) : null; }
  }
  for (const k of S.kits) { k.id = await m(k.id); k.itemIds = await ma(k.itemIds); }
  for (const t of S.trips) { t.id = await m(t.id); t.kitIds = await ma(t.kitIds); t.itemIds = await ma(t.itemIds); t.excluded = await ma(t.excluded); }
  return map;
}
