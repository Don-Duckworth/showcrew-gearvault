// Unit tests for js/carnet.js + js/store.js. Run: node tools/test-carnet.mjs
import * as C from '../js/carnet.js';
import * as St from '../js/store.js';
import * as M from '../js/cloudmap.js';
import * as X from '../js/emx.js';
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

// ---------- v2.1 Electromaxx # ----------
const sc = t => X.emxFromScan(t).emx;
ok(sc('004217') === '004217' && sc(' 004217\r\n') === '004217', 'scan: plain 6 digits (whitespace/control chars trimmed)');
ok(sc('EMX-004218') === '004218' && sc('https://electromaxx.example/gear/004221?x=1') === '004221' && sc('GV|004217') === '004217', 'scan: 6-digit run inside Code 39 / QR URL text');
ok(sc('0000000042208') === '004220', 'scan: EAN-13 with valid check digit → check digit + leading zeros stripped');
ok(sc('004219') === '004219' && sc('00004219') === '004219', 'scan: ITF / zero-padded all-digit codes');
ok(sc('1234567') === null && sc('123456789012') === null && sc('SN-ABCDEFG') === null, 'scan: 7+ significant digits or no digits → no number');
ok(sc('004217 / 004218') === null && X.emxFromScan('004217 / 004218').candidates.join() === '004217,004218', 'scan: two different numbers → ambiguous, both offered');
ok(X.gs1Valid('4006381333931') && !X.gs1Valid('4006381333932') && X.gs1Valid('036000291452'), 'GS1 check digit (EAN-13, UPC-A)');
ok(X.looseEmx('4217') === '004217' && X.looseEmx('4217.0') === '004217' && X.looseEmx('#004217') === '004217' && X.looseEmx('1234567') === '' && X.looseEmx('AB12') === '', 'spreadsheet number restores leading zeros');
ok(X.normEmx('004217') === '004217' && X.normEmx('4217') === '' && X.normEmx(null) === '', 'stored number must be exactly 6 digits');
const SE = St.sanitizeState({ items: [{ id: 'a', emx: '004217' }, { id: 'b', emx: '004217' }, { id: 'c', emx: '12' }, { id: 'd' }] });
ok(SE.items.map(i => i.emx).join() === '004217,,,', 'sanitize: invalid dropped, duplicate cleared (first keeps it)');
ok(X.emxOwners(SE.items, '004217', 'b').length === 1 && X.emxOwners(SE.items, '004217', 'a').length === 0, 'duplicate lookup excludes the item itself');
const S3 = St.sanitizeState({ items: [{ id: 'x1', name: 'Laptop', serial: 'C02', emx: '004217', price: 10, origin: 'China' }, { id: 'x2', name: 'Cable', serial: 'N/A', price: 5, origin: 'China' }], trips: [{ id: 't1', name: 'T', itemIds: ['x1', 'x2'], emxCol: true }] });
await M.remapIds(S3, UID);
const R3 = M.rowsFromState(S3, UID);
const r1 = [...R3.items.values()].find(r => r.name === 'Laptop'), r2 = [...R3.items.values()].find(r => r.name === 'Cable');
ok(r1.electromaxx_no === '004217' && r2.electromaxx_no === null && [...R3.trips.values()][0].show_emx === true, 'cloud rows: electromaxx_no (NULL when empty), trips.show_emx');
const B3 = M.stateFromRows(Object.fromEntries(M.TABLES.map(t => [t, [...R3[t].values()]])));
ok(B3.items.find(i => i.name === 'Laptop').emx === '004217' && B3.items.find(i => i.name === 'Cable').emx === '' && B3.trips[0].emxCol === true, 'rows → state round-trip keeps Electromaxx # + column toggle');
const gl3 = C.buildGeneralList(B3, B3.trips[0]);
const g3 = C.generalListCSV(gl3, B3.trips[0]);
ok(/Serial number,Electromaxx #,Number of pieces/.test(g3) && /,C02,004217,1,/.test(g3) && /,N\/A,,1,/.test(g3), 'general list CSV: optional Electromaxx # column');
ok(!C.generalListCSV(gl3, { ...B3.trips[0], emxCol: false }).includes('Electromaxx'), 'general list CSV: column absent when toggle off (default)');
const inv3 = C.inventoryCSV(B3.items);
ok(inv3.split('\r\n')[0].split(',').includes('Electromaxx #') && inv3.includes(',004217,'), 'inventory CSV exports “Electromaxx #”');
const back3 = C.parseInventoryCSV(inv3);
ok(back3.find(o => o.name === 'Laptop').emx === '004217', 'inventory CSV re-import reads its own column');
for (const h of ['Electromaxx #', 'electromaxx no', 'Electromaxx  Number', 'EMX', 'Asset Tag', 'electromaxx_no']) {
  const o = C.parseInventoryCSV(`Name,${h}\nThing,4217\n`)[0]; ok(o.emx === '004217', `CSV alias “${h}”`);
}

// ---------- v2.2 parts & accessories ----------
const P = await import('../js/parts.js');
const PS = St.sanitizeState({ items: [
  { id: 'pc', name: 'SAMPLE Playback PC', make: 'SampleCorp', model: '2U', serial: 'SAMPLE-PC1', emx: '004300', price: 5000, origin: 'Taiwan', weight: 18 },
  { id: 'gpu', name: 'SAMPLE GPU', make: 'NVIDIA', model: 'RTX A4000', serial: 'SAMPLE-GPU1', price: 1000, origin: 'China', weight: 1, parentId: 'pc', partType: 'installed' },
  { id: 'cap', name: 'SAMPLE Capture card', make: 'Blackmagic Design', model: 'DeckLink Duo 2', serial: 'SAMPLE-DL2', price: 500, origin: '', parentId: 'pc', partType: 'installed' },
  { id: 'nvme', name: 'SAMPLE NVMe on GPU riser', serial: 'SAMPLE-NV1', price: 200, origin: 'Korea', parentId: 'gpu', partType: 'installed' },
  { id: 'psu', name: 'SAMPLE Spare PSU', serial: 'SAMPLE-PSU1', price: 150, origin: 'China', weight: 2, qty: 2, parentId: 'pc', partType: 'accessory' },
  { id: 'rem', name: 'SAMPLE Remote for PSU', serial: 'SAMPLE-REM', price: 20, origin: 'China', weight: 0.1, parentId: 'psu' },
  { id: 'lap', name: 'SAMPLE Laptop', serial: 'SAMPLE-LAP', price: 3000, origin: 'China', weight: 2 },
  { id: 'loop1', name: 'loop a', parentId: 'loop2' }, { id: 'loop2', name: 'loop b', parentId: 'loop1' }, { id: 'orphan', name: 'orphan', parentId: 'gone' } ],
  kits: [{ id: 'k', name: 'Rack A', itemIds: ['pc'] }] });
const pi = id => PS.items.find(i => i.id === id);
ok(pi('rem').partType === 'accessory' && pi('lap').partType === '' && pi('gpu').partType === 'installed', 'partType normalized (parent without type → accessory, standalone → none)');
ok(!pi('orphan').parentId && [pi('loop1'), pi('loop2')].filter(i => i.parentId).length === 1, 'sanitize drops dangling parents and breaks cycles');
ok(P.descendants(PS.items, 'pc').map(i => i.id).join() === 'gpu,nvme,cap,psu,rem', 'descendants depth-first');
ok(P.ancestors(PS.items, 'nvme').map(i => i.id).join() === 'gpu,pc', 'ancestors chain');
ok(P.wouldCycle(PS.items, 'pc', 'nvme') && P.wouldCycle(PS.items, 'pc', 'pc') && !P.wouldCycle(PS.items, 'nvme', 'lap') && !P.wouldCycle(PS.items, 'lap', 'pc'), 'wouldCycle: self/descendant rejected, others ok');
ok(P.normPartType('Installed inside') === 'installed' && P.normPartType('separate accessory') === 'accessory' && P.normPartType('Accessory') === 'accessory' && P.normPartType('x') === '', 'part type parsing');
const vw = P.valueWithParts(PS.items, 'pc', C.unitValue);
ok(vw.value === 5000 + 1000 + 500 + 200 + 300 + 20 && vw.parts === 5, 'value incl. parts: ' + vw.value);
ok(PS.items.reduce((a, i) => a + (C.unitValue(i) || 0) * i.qty, 0) === 10020, 'flat total counts every item once (no double count)');
ok(C.kitItems(PS, PS.kits[0]).length === 6, 'kit with a parent includes all its descendants');
const PT = { ...St.makeTrip(), kitIds: ['k'], itemIds: ['lap'] };
const pg = C.buildGeneralList(PS, PT);
ok(pg.lines.map(l => l.no).join() === '1,1a,1b,1c,2,3,4', 'line numbers: installed = sub-lines 1a-1c, accessories numbered: ' + pg.lines.map(l => l.no).join());
ok(pg.lines.map(l => l.itemId).join() === 'pc,gpu,nvme,cap,psu,rem,lap', 'order: parent, installed parts, accessories (and their accessories), then next item');
ok(pg.lines[4].note === 'accessory to item 1' && pg.lines[5].note === 'accessory to item 2', 'accessory lines reference their parent line');
ok(pg.totals.lines === 4 && pg.totals.subLines === 3 && pg.totals.pieces === 1 + 2 + 1 + 1, 'pieces count numbered lines only (installed parts are not extra pieces): ' + pg.totals.pieces);
ok(pg.totals.value === 10020, 'totals include installed part values exactly once: ' + pg.totals.value);
ok(pg.totals.weight === 18 + 4 + 0.1 + 2, 'installed parts add no weight (inside the parent): ' + pg.totals.weight);
ok(pg.lines.find(l => l.itemId === 'cap').issues.some(x => x.k === 'origin') && !pg.lines.find(l => l.itemId === 'nvme').issues.some(x => x.k === 'weight'), 'missing-data checks apply to parts (no weight warning for installed)');
const pgx = C.buildGeneralList(PS, { ...PT, excluded: ['gpu'] });
ok(pgx.lines.map(l => l.itemId).join() === 'pc,cap,psu,rem,lap', 'excluding a part line leaves off that part (and its own parts)');
const pgp = C.buildGeneralList(PS, { ...PT, excluded: ['pc'] });
ok(pgp.lines.map(l => l.itemId).join() === 'lap', 'excluding a parent leaves off the parts that came with it');
const pgi = C.buildGeneralList(PS, { ...St.makeTrip(), itemIds: ['cap', 'lap'] });
ok(pgi.lines.map(l => `${l.no}:${l.itemId}`).join() === '1:cap,2:lap', 'part on its own (parent not on the trip) = normal numbered line');
const pf = C.buildGeneralList(PS, { ...PT, foldParts: true });
const pl = pf.lines[0];
ok(pf.lines.length === 4 && !pf.lines.some(l => l.sub) && pl.value === 6700 && pl.folded.length === 3, 'fold: installed parts folded into parent line (value 5000+1000+500+200)');
ok(/incl\. installed: .*S\/N SAMPLE-GPU1.*S\/N SAMPLE-NV1.*S\/N SAMPLE-DL2/.test(pl.description), 'fold: part serials appended to the description: ' + pl.description);
ok(pf.totals.value === 10020 && pf.totals.pieces === 5 && pl.issues.some(x => x.k === 'origin' && /Capture/.test(x.msg)), 'fold: same totals; part issues flagged on the parent line');
const pcsv = C.generalListCSV(pg, PT), prow = C.parseCSV(pcsv);
const r1a = prow.find(r => r[0] === '1a'), rr2 = prow.find(r => r[0] === "2");
ok(r1a && r1a[1].includes('installed in item 1') && r1a[2] === 'SAMPLE-GPU1' && r1a[3] === '' && r1a[5] === '1000.00' && r1a[6] === 'China', 'general list CSV: sub-line 1a with serial, value, origin, no pieces');
ok(rr2 && rr2[1].includes('accessory to item 1') && rr2[3] === "2", 'general list CSV: accessory has its own line + pieces');
ok(prow.some(r => r[1] === 'TOTAL' && r[3] === '5' && r[5] === '10020.00'), 'general list CSV: totals');
const pinv = C.inventoryCSV(PS.items), head = pinv.split('\r\n')[0];
ok(head.endsWith('Parent Electromaxx #,Parent serial,Part type'), 'inventory CSV: parent columns');
const pback = C.parseInventoryCSV(pinv);
ok(pback.find(o => o.name === 'SAMPLE GPU').parentEmx === '004300' && pback.find(o => o.name === 'SAMPLE GPU').partType === 'installed' && pback.find(o => o.name === 'SAMPLE NVMe on GPU riser').parentSerial === 'SAMPLE-GPU1', 'inventory CSV round-trip of parent links');
ok(C.findParentFor(PS.items, { parentEmx: '004300' }).id === 'pc' && C.findParentFor(PS.items, { parentSerial: 'sample-psu1' }).id === 'psu' && C.findParentFor(PS.items, { parentSerial: 'nope' }) === null, 'CSV parent lookup by Electromaxx # or serial');
const pal = C.parseInventoryCSV('Name,Parent EMX,Parent S/N,Part_Type\nSAMPLE RAM,4300,,Installed inside\nSAMPLE Bag,,SAMPLE-LAP,separate accessory\n');
ok(pal[0].parentEmx === '004300' && pal[0].partType === 'installed' && pal[1].parentSerial === 'SAMPLE-LAP' && pal[1].partType === 'accessory', 'parent column aliases');
// cloud rows
const PS2 = St.sanitizeState(JSON.parse(JSON.stringify(PS))); await M.remapIds(PS2, UID);
const PR = M.rowsFromState(PS2, UID), prs = [...PR.items.values()];
const pos2 = n => prs.findIndex(r => r.name === n);
ok(prs.find(r => r.name === 'SAMPLE GPU').parent_id === PS2.items.find(i => i.name === 'SAMPLE Playback PC').id && prs.find(r => r.name === 'SAMPLE GPU').part_type === 'installed' && prs.find(r => r.name === 'SAMPLE Laptop').parent_id === null && prs.find(r => r.name === 'SAMPLE Laptop').part_type === null, 'rows: parent_id remapped to UUID, part_type (NULL when standalone)');
ok(pos2('SAMPLE Playback PC') < pos2('SAMPLE GPU') && pos2('SAMPLE GPU') < pos2('SAMPLE NVMe on GPU riser') && pos2('SAMPLE Spare PSU') < pos2('SAMPLE Remote for PSU'), 'rows: parents upserted before their parts');
const PB = M.stateFromRows(Object.fromEntries(M.TABLES.map(t => [t, [...PR[t].values()]])));
ok(PB.items.find(i => i.name === 'SAMPLE NVMe on GPU riser').parentId === PS2.items.find(i => i.name === 'SAMPLE GPU').id && PB.items.find(i => i.name === 'SAMPLE Spare PSU').partType === 'accessory', 'rows → state keeps parent links');
const PT2 = { ...St.makeTrip(), foldParts: true }; PS2.trips = [PT2];
ok([...M.rowsFromState(PS2, UID).trips.values()][0].fold_parts === true && M.stateFromRows(Object.fromEntries(M.TABLES.map(t => [t, [...M.rowsFromState(PS2, UID)[t].values()]]))).trips[0].foldParts === true, 'trips.fold_parts round-trip');
ok(P.parentsFirst([{ id: 'c', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'a', parentId: '' }]).map(i => i.id).join() === 'a,b,c', 'parentsFirst ordering');
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
