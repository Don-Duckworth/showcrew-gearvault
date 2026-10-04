// Unit tests for js/carnet.js + js/store.js. Run: node tools/test-carnet.mjs
import * as C from '../js/carnet.js';
import * as St from '../js/store.js';
import * as M from '../js/cloudmap.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const it = (o) => St.sanitizeItem(o);
const a = it({ id: 'a', name: 'Show laptop A', make: 'Apple', model: 'MacBook Pro 16"', serial: 'X1', price: 3499, origin: 'China', weight: 2.14, weightUnit: 'kg' });
const b = it({ id: 'b', name: 'Shure SLXD24 receiver', make: 'Shure', model: 'SLXD4', serial: 'S1, S2', qty: 2, price: 500, currentValue: 400, origin: 'Mexico', weight: 2, weightUnit: 'lb' });
const c = it({ id: 'c', name: 'Gaff tape', price: null, origin: '', serial: '' });
ok(C.tradeDescription(a) === 'Apple MacBook Pro 16" – Show laptop A', 'trade description joins make/model/name: ' + C.tradeDescription(a));
ok(C.tradeDescription(it({ name: 'Apple Mac Studio M2', make: 'Apple', model: 'Mac Studio' })) === 'Apple Mac Studio M2', 'no duplicate when name contains make+model');
ok(C.tradeDescription(a, true).endsWith('(S/N X1)'), 'serial-in-description option');
const S = { items: [a, b, c], kits: [{ id: 'k1', name: 'Rack A', itemIds: ['b', 'a'] }], trips: [] };
const trip = { ...St.makeTrip(), kitIds: ['k1'], itemIds: ['a', 'c'], currency: 'USD', weightUnit: 'kg' };
const gl = C.buildGeneralList(S, trip);
ok(gl.lines.map(l => l.itemId).join() === 'b,a,c', 'kit order then extra items, deduped: ' + gl.lines.map(l => l.itemId).join());
ok(gl.lines[0].value === 800 && gl.lines[0].usesCurrent, 'current value overrides price and multiplies by pieces (2×400)');
ok(Math.abs(gl.lines[0].weight - 1.81) < 0.01, '2×2 lb → 1.81 kg: ' + gl.lines[0].weight);
ok(gl.totals.pieces === 4 && gl.totals.value === 4299, 'totals pieces 4 value 4299: ' + JSON.stringify(gl.totals));
ok(gl.totals.errors === 1 && gl.counts.serial === 1 && gl.counts.origin === 1 && gl.counts.value === 1, 'missing serial/value/origin flagged on gaff tape');
const gl2 = C.buildGeneralList(S, { ...trip, excluded: ['c'], weightUnit: 'lb' });
ok(gl2.lines.length === 2 && gl2.totals.errors === 0, 'excluded item dropped');
ok(Math.abs(gl2.lines[1].weight - 4.72) < 0.01, '2.14 kg → 4.72 lb');
const eur = it({ ...a, id: 'e', currency: 'EUR' });
ok(C.itemIssues(eur, 'USD').some(x => x.k === 'currency'), 'currency mismatch flagged');
const csv = C.generalListCSV(gl, { ...trip, name: 'Test, "quoted"' });
ok(csv.startsWith('\uFEFF') && csv.includes('\r\n') && csv.includes('"Test, ""quoted"""'), 'CSV has BOM, CRLF, quoting');
const back = C.parseCSV(csv);
ok(back.some(r => r[0] === '1' && r[1] === 'Shure SLXD4 – Shure SLXD24 receiver' && r[2] === 'S1, S2'), 'CSV round-trips a line');
const inv = C.inventoryCSV([a, b]);
const parsed = C.parseInventoryCSV(inv);
ok(parsed.length === 2 && parsed[0].model === 'MacBook Pro 16"' && parsed[1].tags === '' && parsed[1].currentValue === '400', 'inventory CSV round trip');
const alias = C.parseInventoryCSV('Description,Brand,Serial Number,Price,Country of Origin\nRouter,Ubiquiti,U123,199.99,China\n');
ok(alias[0].name === 'Router' && alias[0].make === 'Ubiquiti' && alias[0].serial === 'U123' && alias[0].origin === 'China', 'CSV header aliases');
ok(St.sanitizeItem({ price: '$1,299.50', qty: '0', tags: 'a; b, a' }).price === 1299.5, 'price parsing strips $ and commas');
ok(St.sanitizeItem({ qty: '0' }).qty === 1 && St.sanitizeItem({ tags: 'a; b, a' }).tags.join() === 'a,b', 'qty min 1, tags dedupe');
let threw = false; try { St.sanitizeState({}); } catch { threw = true; } ok(threw, 'rejects non-backup JSON');

// ---------- v2 cloud mapping ----------
const UID = '0d0d0d0d-1111-4222-8333-444455556666';
const S2 = St.sanitizeState({ settings: { categories: ['Laptop – Mac', 'Other'], currency: 'USD', weightUnit: 'lb', holder: 'Don' }, items: [
  { id: 'itm_1', name: 'Laptop', price: 100, currentValue: 80, purchaseDate: '2024-01-02', tags: ['a', 'b'], atts: [{ id: 'att_1', name: 'p.png', type: 'image/png', size: 5, kind: 'photo', added: 1700000000000 }] },
  { id: 'itm_2', name: 'Cable', price: null, weight: 0.2 }],
  kits: [{ id: 'kit_1', name: 'Rack', itemIds: ['itm_2', 'itm_1', 'gone'] }], trips: [{ id: 'trp_1', name: 'London', kitIds: ['kit_1'], itemIds: ['itm_2'], excluded: ['itm_1'], depart: '2026-11-02' }] });
const map = await M.remapIds(S2, UID);
ok(S2.items.every(i => M.UUID_RE.test(i.id)) && M.UUID_RE.test(S2.kits[0].id) && S2.kits[0].itemIds[0] === S2.items[1].id, 'remapIds gives UUIDs and keeps references');
ok(S2.items[0].atts[0].path === `${UID}/${S2.items[0].id}/${S2.items[0].atts[0].id}` && S2.items[0].atts[0].thumb.endsWith('.thumb.jpg'), 'attachment path is <uid>/<item>/<att>');
const again = St.sanitizeState({ items: [{ id: 'itm_1' }] }); await M.remapIds(again, UID);
ok(again.items[0].id === map.get('itm_1'), 'remapIds is deterministic per user (re-upload never duplicates)');
const other = St.sanitizeState({ items: [{ id: 'itm_1' }] }); await M.remapIds(other, '99999999-1111-4222-8333-444455556666');
ok(other.items[0].id !== map.get('itm_1'), 'different user → different ids');
const rows = M.rowsFromState(S2, UID);
ok(rows.items.size === 2 && rows.kit_items.size === 2 && rows.trip_kits.size === 1 && rows.trip_items.size === 2 && rows.attachments.size === 1 && rows.categories.size === 2, 'rowsFromState table sizes (dangling kit ref dropped)');
ok([...rows.items.values()].every(r => r.owner_id === UID) && [...rows.trip_items.values()].some(r => r.mode === 'exclude'), 'owner_id on every row, exclusions as mode=exclude');
const it2 = rows.items.get(S2.items[1].id); ok(it2.price === null && it2.purchase_date === null && it2.weight === 0.2, 'nulls for empty numbers/dates');
const R = Object.fromEntries(M.TABLES.map(t => [t, [...rows[t].values()].map(r => ({ ...r, created_at: '2026-10-04T18:00:00Z', updated_at: '2026-10-04T18:00:00Z' }))]));
R.items.forEach(r => { if (r.price != null) r.price = String(r.price); }); // PostgREST may return numerics as strings
const bk = M.stateFromRows(R);
ok(bk.items.length === 2 && bk.items[0].price === 100 && bk.items[0].currentValue === 80 && bk.items[0].tags.join() === 'a,b' && bk.items[0].atts[0].path === S2.items[0].atts[0].path, 'stateFromRows restores items + attachments');
ok(bk.kits[0].itemIds.join() === S2.kits[0].itemIds.filter(id => S2.items.some(i => i.id === id)).join() && bk.trips[0].excluded[0] === S2.items[0].id && bk.trips[0].depart === '2026-11-02', 'kits/trips relations round-trip');
ok(bk.settings.weightUnit === 'lb' && bk.settings.categories.join() === 'Laptop – Mac,Other', 'settings + category order round-trip');
const snap = M.snapshotOf(M.rowsFromState(bk, UID));
ok(M.diff(snap, M.rowsFromState(bk, UID)).count === 0, 'no diff right after load');
bk.items[0].name = 'Laptop 2'; bk.kits[0].itemIds.pop(); bk.settings.categories.push('New');
const d = M.diff(snap, M.rowsFromState(bk, UID));
ok(d.up.items.length === 1 && d.del.kit_items.length === 1 && d.up.categories.length === 1 && d.count === 3, 'diff finds exactly the changed/removed rows');
bk.items = bk.items.slice(1);
const d2 = M.diff(snap, M.rowsFromState(bk, UID));
ok(d2.del.items.length === 1 && d2.del.attachments.length === 1 && d2.del.attachments[0].path, 'deleting an item deletes its attachment rows (with storage path for cleanup)');
ok(M.DELETE_ORDER.indexOf('attachments') < M.DELETE_ORDER.indexOf('items') && M.UPSERT_ORDER.indexOf('items') < M.UPSERT_ORDER.indexOf('kit_items'), 'parents upserted first, children deleted first');
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
