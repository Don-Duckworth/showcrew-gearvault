// ShowCrew GearVault — pure carnet / CSV logic (no DOM). Tested by tools/test-carnet.mjs.
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

/** Items on a trip, in order: each selected kit's items, then individually-added items; de-duplicated; minus exclusions. */
export function tripItems(S, trip) {
  const byId = new Map(S.items.map(i => [i.id, i])), seen = new Set(), out = [], excl = new Set(trip.excluded || []);
  const add = (id, kitName) => { if (seen.has(id) || excl.has(id) || !byId.has(id)) return; seen.add(id); out.push({ item: byId.get(id), kit: kitName }); };
  for (const kid of trip.kitIds || []) { const k = S.kits.find(x => x.id === kid); if (k) k.itemIds.forEach(id => add(id, k.name)); }
  for (const id of trip.itemIds || []) add(id, '');
  return out;
}

/** Problems that matter for a carnet. level 'err' blocks a clean export; 'warn' is advisory. */
export function itemIssues(i, currency = 'USD') {
  const out = [];
  if (!String(i.serial || '').trim()) out.push({ k: 'serial', level: 'err', msg: 'No serial number' });
  const v = unitValue(i);
  if (v == null || !(v > 0)) out.push({ k: 'value', level: 'err', msg: 'No value' });
  else if ((i.currency || 'USD') !== currency) out.push({ k: 'currency', level: 'err', msg: `Value in ${i.currency}, carnet in ${currency}` });
  if (!String(i.origin || '').trim()) out.push({ k: 'origin', level: 'err', msg: 'No country of origin' });
  if (i.weight == null || !(i.weight > 0)) out.push({ k: 'weight', level: 'warn', msg: 'No weight' });
  const sn = serialList(i.serial).length;
  if ((i.qty || 1) > 1 && sn > 1 && sn !== i.qty) out.push({ k: 'qty', level: 'warn', msg: `${i.qty} pcs but ${sn} serials` });
  if (i.status === 'sold' || i.status === 'retired') out.push({ k: 'status', level: 'warn', msg: `Status: ${i.status}` });
  return out;
}

/** ATA Carnet General List lines + totals. Value & weight are line totals (unit × pieces). */
export function buildGeneralList(S, trip) {
  const cur = trip.currency || 'USD', wu = trip.weightUnit || 'kg';
  const lines = tripItems(S, trip).map(({ item: i, kit }, n) => {
    const qty = Math.max(1, i.qty || 1), uv = unitValue(i), wkg = toKg(i.weight, i.weightUnit);
    return {
      no: n + 1, itemId: i.id, kit, description: tradeDescription(i, trip.serialInDesc), serial: (i.serial || '').trim(), pieces: qty,
      weight: wkg == null ? null : round2(fromKg(wkg * qty, wu)), value: uv == null ? null : round2(uv * qty), unitValue: uv,
      currency: i.currency || cur, origin: (i.origin || '').trim(), usesCurrent: i.currentValue != null, issues: itemIssues(i, cur),
    };
  });
  const totals = {
    lines: lines.length, pieces: lines.reduce((a, l) => a + l.pieces, 0),
    weight: round2(lines.reduce((a, l) => a + (l.weight || 0), 0)),
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
  const rows = [
    ['ATA Carnet General List', trip.name || ''],
    ['Holder', trip.holder || ''], ['Destination(s)', trip.destinations || ''], ['Dates', [trip.depart, trip.ret].filter(Boolean).join(' to ')],
    ['Carnet no.', trip.carnetNo || ''], ['Values', `Current fair market value in ${gl.currency}`], [],
    ['Item No.', 'Trade description of goods (make, model, description)', 'Serial number', 'Number of pieces', `Weight (${gl.weightUnit})`, `Value (${gl.currency})`, 'Country of origin'],
    ...gl.lines.map(l => [l.no, l.description, l.serial, l.pieces, l.weight == null ? '' : l.weight.toFixed(2), l.value == null ? '' : l.value.toFixed(2), l.origin]),
    ['', 'TOTAL', '', gl.totals.pieces, gl.totals.weight.toFixed(2), gl.totals.value.toFixed(2), ''],
  ];
  return toCSV(rows);
}

// ---------- inventory CSV ----------
export const INV_COLS = [
  ['id', 'id'], ['name', 'name'], ['category', 'category'], ['make', 'make'], ['model', 'model'], ['serial', 'serial'], ['qty', 'qty'],
  ['status', 'status'], ['purchase_date', 'purchaseDate'], ['purchase_price', 'price'], ['currency', 'currency'], ['current_value', 'currentValue'],
  ['vendor', 'vendor'], ['country_of_origin', 'origin'], ['weight', 'weight'], ['weight_unit', 'weightUnit'], ['tags', 'tags'], ['notes', 'notes'],
];
const ALIASES = {
  name: ['name', 'description', 'item', 'item name'], category: ['category', 'type'], make: ['make', 'brand', 'manufacturer'], model: ['model'],
  serial: ['serial', 'serial number', 'serial no', 's/n', 'sn'], qty: ['qty', 'quantity', 'pieces', 'number of pieces'], status: ['status'],
  purchaseDate: ['purchase_date', 'purchase date', 'date purchased', 'date'], price: ['purchase_price', 'purchase price', 'price', 'cost'],
  currency: ['currency'], currentValue: ['current_value', 'current value', 'value', 'fair market value', 'fmv'], vendor: ['vendor', 'seller', 'store', 'supplier'],
  origin: ['country_of_origin', 'country of origin', 'origin', 'coo'], weight: ['weight'], weightUnit: ['weight_unit', 'weight unit', 'unit'],
  tags: ['tags', 'tag'], notes: ['notes', 'note', 'comments'], id: ['id'],
};
export function inventoryCSV(items) {
  return toCSV([INV_COLS.map(c => c[0]), ...items.map(i => INV_COLS.map(([, k]) => (k === 'tags' ? (i.tags || []).join('; ') : i[k])))]);
}
/** Returns plain objects keyed by item field names (unsanitized). */
export function parseInventoryCSV(text) {
  const rows = parseCSV(text); if (rows.length < 2) throw new Error('CSV needs a header row and at least one item');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const map = {}; for (const [k, al] of Object.entries(ALIASES)) { const ix = head.findIndex(h => al.includes(h)); if (ix >= 0) map[k] = ix; }
  if (map.name == null && map.model == null && map.id == null) throw new Error('CSV needs a "name" (or "model", or "id") column');
  return rows.slice(1).map(r => { const o = {}; for (const [k, ix] of Object.entries(map)) o[k] = (r[ix] ?? '').trim(); if (o.status) o.status = o.status.toLowerCase(); return o; })
    .filter(o => o.name || o.model || o.id);
}
