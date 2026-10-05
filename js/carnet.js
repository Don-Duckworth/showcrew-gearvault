// ShowCrew GearVault — pure carnet / CSV logic (no DOM). Tested by tools/test-carnet.mjs.
import { looseEmx } from './emx.js';
import { childIndex, partTypeOf, normPartType } from './parts.js';
export const LB_PER_KG = 2.2046226218;
export const toKg = (w, unit) => (w == null ? null : unit === 'lb' ? w / LB_PER_KG : w);
export const fromKg = (kg, unit) => (kg == null ? null : unit === 'lb' ? kg * LB_PER_KG : kg);
export const round2 = n => Math.round(n * 100) / 100;

/** Value used on the carnet: optional current fair-market value, else purchase price. Per unit. */
export const unitValue = i => (i.currentValue != null ? i.currentValue : i.price);

export function tradeDescription(i, withSerial = false) {
  const base = [i.make, i.model].map(x => (x || '').trim()).filter(Boolean).join(' ');
  const name = (i.name || '').trim();
  let d = !base ? name : !name || name.toLowerCase().includes(base.toLowerCase()) ? (name || base) : `${base} – ${name}`;
  if (withSerial && i.serial) d += ` (S/N ${i.serial})`;
  return d;
}
export const serialList = s => String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);

/** Items on a trip, in order: each selected kit's items, then individually-added items; every item brings its parts (descendants)
 *  along right after it; de-duplicated; minus exclusions (excluding a parent also leaves off the parts that came with it). */
export function tripItems(S, trip) {
  const byId = new Map(S.items.map(i => [i.id, i])), seen = new Set(), out = [], excl = new Set(trip.excluded || []), kids = childIndex(S.items);
  const add = (id, kitName, via = '') => {
    if (seen.has(id) || excl.has(id) || !byId.has(id)) return;
    seen.add(id); out.push({ item: byId.get(id), kit: kitName, via });
    for (const c of kids.get(id) || []) add(c.id, kitName, id);
  };
  for (const kid of trip.kitIds || []) { const k = S.kits.find(x => x.id === kid); if (k) k.itemIds.forEach(id => add(id, k.name)); }
  for (const id of trip.itemIds || []) add(id, '');
  return out;
}
/** Kit contents including every part of every item in it (deduped). */
export function kitItems(S, kit) {
  const t = { kitIds: [kit.id], itemIds: [], excluded: [] };
  return tripItems({ ...S, kits: [kit] }, t).map(x => x.item);
}

/** Problems that matter for a carnet. level 'err' blocks a clean export; 'warn' is advisory. */
export function itemIssues(i, currency = 'USD', { installed = false } = {}) {
  const out = [];
  if (!String(i.serial || '').trim()) out.push({ k: 'serial', level: 'err', msg: 'No serial number' });
  const v = unitValue(i);
  if (v == null || !(v > 0)) out.push({ k: 'value', level: 'err', msg: 'No value' });
  else if ((i.currency || 'USD') !== currency) out.push({ k: 'currency', level: 'err', msg: `Value in ${i.currency}, carnet in ${currency}` });
  if (!String(i.origin || '').trim()) out.push({ k: 'origin', level: 'err', msg: 'No country of origin' });
  if (!installed && (i.weight == null || !(i.weight > 0))) out.push({ k: 'weight', level: 'warn', msg: 'No weight' }); // installed parts weigh in with the parent
  const sn = serialList(i.serial).length;
  if ((i.qty || 1) > 1 && sn > 1 && sn !== i.qty) out.push({ k: 'qty', level: 'warn', msg: `${i.qty} pcs but ${sn} serials` });
  if (i.status === 'sold' || i.status === 'retired') out.push({ k: 'status', level: 'warn', msg: `Status: ${i.status}` });
  return out;
}

/** ATA Carnet General List lines + totals. Value & weight are line totals (unit × pieces).
 *  Parts (v2.2): an *accessory* is its own numbered line (counted as pieces). *Installed* parts become sub-lines of the line they sit in
 *  (3a, 3b … — description, serial, value, origin) that add value to the totals but no pieces and no weight. With trip.foldParts the
 *  installed parts are folded into the parent line instead (value added, part serials appended to the description). */
export function buildGeneralList(S, trip) {
  const cur = trip.currency || 'USD', wu = trip.weightUnit || 'kg', fold = !!trip.foldParts;
  const entries = tripItems(S, trip), inTrip = new Map(entries.map(e => [e.item.id, e]));
  // effective tree among the items on this trip
  const kidsInTrip = new Map(), roots = [];
  for (const e of entries) {
    const p = e.item.parentId && inTrip.has(e.item.parentId) ? e.item.parentId : null;
    if (p) { if (!kidsInTrip.has(p)) kidsInTrip.set(p, []); kidsInTrip.get(p).push(e); } else roots.push(e);
  }
  const lines = []; let n = 0;
  const baseLine = (i, kit) => {
    const qty = Math.max(1, i.qty || 1), uv = unitValue(i), wkg = toKg(i.weight, i.weightUnit);
    return {
      no: 0, itemId: i.id, kit, description: tradeDescription(i, trip.serialInDesc), serial: (i.serial || '').trim(), emx: i.emx || '', pieces: qty,
      weight: wkg == null ? null : round2(fromKg(wkg * qty, wu)), value: uv == null ? null : round2(uv * qty), unitValue: uv,
      currency: i.currency || cur, origin: (i.origin || '').trim(), usesCurrent: i.currentValue != null, issues: itemIssues(i, cur),
      sub: false, partType: partTypeOf(i), parentItemId: i.parentId && inTrip.has(i.parentId) ? i.parentId : '', note: '', folded: [],
    };
  };
  const emitNumbered = (e, accessoryOf = 0) => {
    const line = baseLine(e.item, e.kit); line.no = ++n; if (accessoryOf) line.note = `accessory to item ${accessoryOf}`;
    lines.push(line);
    const subs = [], accs = [];
    const walk = id => { for (const c of kidsInTrip.get(id) || []) { if (partTypeOf(c.item) === 'installed') { subs.push(c); walk(c.item.id); } else accs.push(c); } };
    walk(e.item.id);
    if (fold) {
      const bits = [];
      for (const c of subs) {
        const i = c.item, qty = Math.max(1, i.qty || 1), uv = unitValue(i), t = tradeDescription(i, false), sn = (i.serial || '').trim();
        bits.push(`${qty > 1 ? qty + '× ' : ''}${t}${sn ? ` S/N ${sn}` : ''}`);
        if (uv != null && (i.currency || cur) === line.currency) line.value = round2((line.value || 0) + uv * qty);
        for (const x of itemIssues(i, cur, { installed: true })) line.issues.push({ ...x, part: i.id, msg: `Installed “${t}”: ${x.msg.toLowerCase()}` });
        line.folded.push(i.id);
      }
      if (bits.length) line.description += ` — incl. installed: ${bits.join('; ')}`;
    } else {
      let letter = 0;
      for (const c of subs) {
        const sl = baseLine(c.item, c.kit);
        Object.assign(sl, { no: `${line.no}${String.fromCharCode(97 + (letter % 26))}${letter >= 26 ? Math.floor(letter / 26) : ''}`, sub: true, pieces: 0, weight: null, hostNo: line.no, issues: itemIssues(c.item, cur, { installed: true }) });
        letter++; lines.push(sl);
      }
    }
    for (const a of accs) emitNumbered(a, line.no);
  };
  for (const e of roots) emitNumbered(e);
  const main = lines.filter(l => !l.sub);
  const totals = {
    lines: main.length, subLines: lines.length - main.length, pieces: main.reduce((a, l) => a + l.pieces, 0),
    weight: round2(main.reduce((a, l) => a + (l.weight || 0), 0)),
    value: round2(lines.reduce((a, l) => a + (l.currency === cur && l.value ? l.value : 0), 0)),
    errors: lines.filter(l => l.issues.some(x => x.level === 'err')).length,
    warnings: lines.filter(l => l.issues.some(x => x.level === 'warn')).length,
  };
  const counts = {}; for (const l of lines) for (const x of l.issues) counts[x.k] = (counts[x.k] || 0) + 1;
  return { lines, totals, counts, currency: cur, weightUnit: wu };
}

// ---------- CSV ----------
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Excel-friendly CSV: UTF-8 BOM + CRLF. */
export const toCSV = rows => '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function generalListCSV(gl, trip) {
  const emx = !!trip.emxCol; // optional internal asset-tag column (off by default)
  const rows = [
    ['ATA Carnet General List', trip.name || ''],
    ['Holder', trip.holder || ''], ['Destination(s)', trip.destinations || ''], ['Dates', [trip.depart, trip.ret].filter(Boolean).join(' to ')],
    ['Carnet no.', trip.carnetNo || ''], ['Values', `Current fair market value in ${gl.currency}`], [],
    ['Item No.', 'Trade description of goods (make, model, description)', 'Serial number', ...(emx ? ['Electromaxx #'] : []), 'Number of pieces', `Weight (${gl.weightUnit})`, `Value (${gl.currency})`, 'Country of origin'],
    ...gl.lines.map(l => [l.no, l.description + (l.sub ? ' (installed in item ' + l.hostNo + ')' : l.note ? ` (${l.note})` : ''), l.serial, ...(emx ? [l.emx] : []), l.sub ? '' : l.pieces, l.weight == null ? '' : l.weight.toFixed(2), l.value == null ? '' : l.value.toFixed(2), l.origin]),
    ['', 'TOTAL', '', ...(emx ? [''] : []), gl.totals.pieces, gl.totals.weight.toFixed(2), gl.totals.value.toFixed(2), ''],
  ];
  return toCSV(rows);
}

// ---------- inventory CSV ----------
export const INV_COLS = [
  ['id', 'id'], ['name', 'name'], ['category', 'category'], ['make', 'make'], ['model', 'model'], ['serial', 'serial'], ['Electromaxx #', 'emx'], ['qty', 'qty'],
  ['status', 'status'], ['purchase_date', 'purchaseDate'], ['purchase_price', 'price'], ['currency', 'currency'], ['current_value', 'currentValue'],
  ['vendor', 'vendor'], ['country_of_origin', 'origin'], ['weight', 'weight'], ['weight_unit', 'weightUnit'], ['tags', 'tags'], ['notes', 'notes'],
  ['Parent Electromaxx #', 'parentEmx'], ['Parent serial', 'parentSerial'], ['Part type', 'partType'],
];
const ALIASES = {
  name: ['name', 'description', 'item', 'item name'], category: ['category', 'type'], make: ['make', 'brand', 'manufacturer'], model: ['model'],
  serial: ['serial', 'serial number', 'serial no', 's/n', 'sn'],
  emx: ['electromaxx #', 'electromaxx', 'electromaxx no', 'electromaxx no.', 'electromaxx number', 'electromaxx_no', 'electromaxx gear number', 'electromaxx gear #', 'emx', 'emx #', 'emx no', 'gear number', 'gear #', 'asset tag', 'asset #', 'asset number', 'asset no', 'barcode'], qty: ['qty', 'quantity', 'pieces', 'number of pieces'], status: ['status'],
  purchaseDate: ['purchase_date', 'purchase date', 'date purchased', 'date'], price: ['purchase_price', 'purchase price', 'price', 'cost'],
  currency: ['currency'], currentValue: ['current_value', 'current value', 'value', 'fair market value', 'fmv'], vendor: ['vendor', 'seller', 'store', 'supplier'],
  origin: ['country_of_origin', 'country of origin', 'origin', 'coo'], weight: ['weight'], weightUnit: ['weight_unit', 'weight unit', 'unit'],
  tags: ['tags', 'tag'], notes: ['notes', 'note', 'comments'], id: ['id'],
  parentEmx: ['parent electromaxx #', 'parent electromaxx', 'parent electromaxx no', 'parent electromaxx number', 'parent electromaxx_no', 'parent emx', 'parent emx #', 'parent asset tag', 'parent_electromaxx_no', 'part of electromaxx #', 'part of emx'],
  parentSerial: ['parent serial', 'parent serial number', 'parent serial no', 'parent s/n', 'parent sn', 'parent_serial', 'part of serial'],
  partType: ['part type', 'part_type', 'part', 'type of part'],
};
export function inventoryCSV(items) {
  const byId = new Map(items.map(i => [i.id, i]));
  const cell = (i, k) => {
    if (k === 'tags') return (i.tags || []).join('; ');
    const p = i.parentId && byId.get(i.parentId);
    if (k === 'parentEmx') return p ? p.emx || '' : '';
    if (k === 'parentSerial') return p ? p.serial || '' : '';
    if (k === 'partType') return p ? partTypeOf(i) : '';
    return i[k];
  };
  return toCSV([INV_COLS.map(c => c[0]), ...items.map(i => INV_COLS.map(([, k]) => cell(i, k)))]);
}
/** Find the parent named by a CSV row (Parent Electromaxx #, else Parent serial — exact, or one of several serials). */
export function findParentFor(items, { parentEmx, parentSerial }, selfId) {
  if (parentEmx) { const p = items.find(i => i.emx === parentEmx && i.id !== selfId); if (p) return p; }
  const sn = String(parentSerial || '').trim().toLowerCase();
  if (sn) {
    const others = items.filter(i => i.id !== selfId);
    return others.find(i => String(i.serial || '').trim().toLowerCase() === sn) || others.find(i => serialList(i.serial).some(x => x.toLowerCase() === sn)) || null;
  }
  return null;
}
/** Returns plain objects keyed by item field names (unsanitized). */
export function parseInventoryCSV(text) {
  const rows = parseCSV(text); if (rows.length < 2) throw new Error('CSV needs a header row and at least one item');
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const map = {}; for (const [k, al] of Object.entries(ALIASES)) { const ix = head.findIndex(h => al.includes(h)); if (ix >= 0) map[k] = ix; }
  if (map.name == null && map.model == null && map.id == null) throw new Error('CSV needs a "name" (or "model", or "id") column');
  return rows.slice(1).map(r => { const o = {}; for (const [k, ix] of Object.entries(map)) o[k] = (r[ix] ?? '').trim(); if (o.status) o.status = o.status.toLowerCase(); if (o.emx != null) { o.emxRaw = o.emx; o.emx = looseEmx(o.emx); } if (o.parentEmx != null) o.parentEmx = looseEmx(o.parentEmx); if (o.partType != null) o.partType = normPartType(o.partType); return o; })
    .filter(o => o.name || o.model || o.id);
}
