// ShowCrew GearVault — persistence (localStorage for records; blobs live in IndexedDB, see files.js) + data model helpers.
import { normEmx, dedupeEmx } from './emx.js';
const KEY = 'showcrew.gearvault.v1'; // v1 on-device data (read only for the cloud upload offer)

// v2: ids are UUIDs (Postgres uuid primary keys). The prefix argument is kept for call-site readability only.
export const uid = (_p = 'id') => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
export const DEFAULT_CATEGORIES = [
  'Laptop – Mac', 'Laptop – PC', 'Rack-mount PC', 'Mac Studio / desktop', 'Audio / sound device', 'Network (e.g. Starlink Mini)',
  'Docking station / hub', 'Display', 'Cable / accessory', 'Case', 'Other',
];
export const STATUSES = [['active', 'Active'], ['repair', 'Repair'], ['sold', 'Sold'], ['retired', 'Retired']];
export const KIT_TYPES = ['Road case', 'Rack', 'Bag', 'Kit', 'Pelican', 'Other'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'MXN', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'CNY', 'BRL', 'ZAR', 'AED'];
export const COUNTRIES = ['China', 'United States', 'Taiwan', 'Japan', 'Vietnam', 'Malaysia', 'Thailand', 'South Korea', 'Mexico', 'Germany',
  'United Kingdom', 'Netherlands', 'France', 'Italy', 'Ireland', 'Israel', 'India', 'Philippines', 'Indonesia', 'Czech Republic', 'Poland',
  'Hungary', 'Canada', 'Switzerland', 'Sweden', 'Denmark', 'Austria', 'Belgium', 'Spain', 'Australia', 'Singapore', 'United Arab Emirates', 'Brazil'];

export function defaultSettings() {
  return { categories: DEFAULT_CATEGORIES.slice(), currency: 'USD', weightUnit: 'kg', holder: '' };
}
export function emptyState() { return { v: 1, items: [], kits: [], trips: [], settings: defaultSettings() }; }

export function makeItem(settings = defaultSettings()) {
  return {
    id: uid('itm'), name: '', category: settings.categories[0] || 'Other', make: '', model: '', serial: '', emx: '', qty: 1,
    purchaseDate: '', price: null, currency: settings.currency || 'USD', currentValue: null, vendor: '', origin: '',
    weight: null, weightUnit: settings.weightUnit || 'kg', notes: '', tags: [], status: 'active', atts: [],
    created: Date.now(), updated: Date.now(),
  };
}
export function makeKit(name = 'New kit') { return { id: uid('kit'), name, type: 'Road case', notes: '', itemIds: [], created: Date.now(), updated: Date.now() }; }
export function makeTrip(settings = defaultSettings(), name = 'New trip') {
  return {
    id: uid('trp'), name, destinations: '', depart: '', ret: '', carnetNo: '', holder: settings.holder || '', purpose: 'Professional equipment',
    currency: settings.currency || 'USD', weightUnit: settings.weightUnit || 'kg', serialInDesc: false, emxCol: false,
    kitIds: [], itemIds: [], excluded: [], notes: '', created: Date.now(), updated: Date.now(),
  };
}

// ---------- sanitizing (load + import) ----------
const s = (v, max = 400) => (v == null ? '' : String(v).slice(0, max));
const numOrNull = v => { if (v === '' || v == null) return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 5000) : []);
export const parseNum = numOrNull;
export function splitTags(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[;,]/);
  return [...new Set(arr.map(t => String(t).trim()).filter(Boolean).map(t => t.slice(0, 40)))].slice(0, 30);
}
export function sanitizeItem(i, settings = defaultSettings()) {
  const base = makeItem(settings);
  const st = STATUSES.some(([k]) => k === i.status) ? i.status : 'active';
  return {
    ...base, id: s(i.id, 60) || base.id, name: s(i.name, 200), category: s(i.category, 80) || base.category, make: s(i.make, 120), model: s(i.model, 120),
    serial: s(i.serial, 400), emx: normEmx(i.emx), qty: Math.max(1, Math.round(numOrNull(i.qty) || 1)), purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(i.purchaseDate || '') ? i.purchaseDate : '',
    price: numOrNull(i.price), currency: (s(i.currency, 3) || base.currency).toUpperCase(), currentValue: numOrNull(i.currentValue),
    vendor: s(i.vendor, 120), origin: s(i.origin, 80), weight: numOrNull(i.weight), weightUnit: i.weightUnit === 'lb' ? 'lb' : 'kg',
    notes: s(i.notes, 4000), tags: splitTags(i.tags), status: st,
    atts: Array.isArray(i.atts) ? i.atts.filter(a => a && a.id).map(a => ({ id: s(a.id, 60), name: s(a.name, 200) || 'file', type: s(a.type, 80), size: +a.size || 0, kind: a.kind === 'receipt' ? 'receipt' : 'photo', added: +a.added || Date.now(), path: a.path ? s(a.path, 300) : undefined, thumb: a.thumb ? s(a.thumb, 300) : null })) : [],
    created: +i.created || Date.now(), updated: +i.updated || Date.now(),
  };
}
export function sanitizeState(d) {
  if (!d || !Array.isArray(d.items)) throw new Error('Not a GearVault backup (no items array).');
  const settings = Object.assign(defaultSettings(), d.settings || {});
  settings.categories = Array.isArray(settings.categories) && settings.categories.length ? [...new Set(settings.categories.map(c => s(c, 80)).filter(Boolean))] : DEFAULT_CATEGORIES.slice();
  settings.weightUnit = settings.weightUnit === 'lb' ? 'lb' : 'kg';
  settings.currency = s(settings.currency, 3).toUpperCase() || 'USD'; settings.holder = s(settings.holder, 200);
  const items = d.items.map(i => sanitizeItem(i, settings));
  const kits = (d.kits || []).map(k => ({ ...makeKit(), ...k, id: s(k.id, 60) || uid('kit'), name: s(k.name, 120) || 'Kit', type: s(k.type, 40) || 'Kit', notes: s(k.notes, 4000), itemIds: ids(k.itemIds) }));
  const trips = (d.trips || []).map(t => ({ ...makeTrip(settings), ...t, id: s(t.id, 60) || uid('trp'), name: s(t.name, 120) || 'Trip', kitIds: ids(t.kitIds), itemIds: ids(t.itemIds), excluded: ids(t.excluded), weightUnit: t.weightUnit === 'lb' ? 'lb' : 'kg', serialInDesc: !!t.serialInDesc, emxCol: !!t.emxCol }));
  dedupeEmx(items); // the database allows each Electromaxx # once per owner
  return { v: 1, items, kits, trips, settings };
}

/** v1 (on-device, pre-cloud) data in this browser, or null. */
export function loadLegacy() {
  try { const raw = localStorage.getItem(KEY); return raw ? sanitizeState(JSON.parse(raw)) : null; }
  catch (e) { console.warn('GearVault: could not read v1 data', e); return null; }
}
export const LEGACY_KEY = KEY;
export const LEGACY_UPLOADED_KEY = KEY + '.uploaded';
