// ShowCrew GearVault — UI controller.
import * as Store from './store.js';
import * as Files from './files.js'; // v1 on-device blobs (upload offer) + thumbnail / base64 helpers
import * as C from './carnet.js';
import * as M from './cloudmap.js';
import * as Cache from './cache.js';
import * as Auth from './auth.js';
import { createCloud } from './cloud.js';
import * as CFG from './config.js';

const APP_VERSION = '2.0.0';
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = Store.emptyState();
const ui = { view: 'gear', q: '', fCat: '', fStatus: '', fTag: '', sort: 'name', tripId: null, edit: null };

// ---------- cloud session / sync state ----------
let sb = null, cloud = null, user = null, bootOffline = false, syncErr = null, syncing = false, syncT = 0, retryT = 0;
const LAST_UID = 'showcrew.gearvault.lastAal2Uid';
const isOffline = () => bootOffline || !navigator.onLine;
const readOnly = () => isOffline() || !cloud;
async function saveCache() { if (user) await Cache.kvSet('state', { uid: user.id, email: user.email, S, savedAt: Date.now() }).catch(() => {}); }
function persist() {
  if (readOnly()) { toast('Offline — changes can\'t be saved. Reconnect to edit.'); return; }
  clearTimeout(syncT); syncT = setTimeout(runSync, 250); renderBadge('saving');
}
async function runSync() {
  if (!cloud || isOffline()) return renderBadge();
  syncing = true; renderBadge();
  try { await cloud.sync(() => S); syncErr = null; clearTimeout(retryT); await saveCache(); }
  catch (e) {
    syncErr = e; console.warn('GearVault sync failed', e);
    toast('⚠ Not saved to the cloud yet — will retry. ' + (e.message || ''), 3200);
    clearTimeout(retryT); retryT = setTimeout(runSync, 8000);
  } finally { syncing = false; renderBadge(); }
}
const unsaved = () => !!(cloud && cloud.pending(S));
function renderBadge(state) {
  const b = $('#netBadge'); if (!b) return;
  let cls = 'ok', txt = 'CLOUD · SYNCED';
  if (isOffline()) { cls = 'off'; txt = 'OFFLINE · READ-ONLY'; }
  else if (state === 'saving' || syncing) { cls = 'busy'; txt = 'SAVING…'; }
  else if (syncErr || unsaved()) { cls = 'err'; txt = 'NOT SAVED · RETRYING'; }
  b.className = 'netbadge ' + cls; b.textContent = txt; b.title = isOffline() ? 'No connection — showing the last synced copy. Editing is disabled.' : syncErr ? String(syncErr.message || syncErr) : 'All changes are saved to Supabase';
  document.body.classList.toggle('readonly', readOnly());
}

// ---------- formatting ----------
function money(v, cur = 'USD', dec = true) {
  if (v == null || !Number.isFinite(v)) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0 }).format(v); }
  catch { return `${cur} ${v.toFixed(dec ? 2 : 0)}`; }
}
const num2 = v => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtW = (kg, unit) => (kg == null ? '—' : `${C.fromKg(kg, unit).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const today = () => new Date().toISOString().slice(0, 10);
const catAbbr = c => (c || '?').replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const itemTitle = i => i.name || [i.make, i.model].filter(Boolean).join(' ') || 'Untitled item';
const kitsOf = id => S.kits.filter(k => k.itemIds.includes(id));
const carnetErrs = i => C.itemIssues(i, S.settings.currency).filter(x => x.level === 'err');
const inService = i => i.status === 'active' || i.status === 'repair';

// ---------- overlay layers (stackable modals) ----------
const layers = [];
function openLayer(html, { cls = '', onClose = null, backdrop = true } = {}) {
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="modal-card ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  o._onClose = onClose; o._backdrop = backdrop;
  o.addEventListener('click', e => { if (e.target === o && o._backdrop) closeLayer(o); });
  document.body.appendChild(o); layers.push(o); return o;
}
function closeLayer(o = layers[layers.length - 1], silent = false) {
  if (!o) return; const i = layers.indexOf(o); if (i >= 0) layers.splice(i, 1);
  o.remove(); if (!silent && o._onClose) o._onClose();
}
function confirmBox(title, okLabel = 'Delete', body = '', okCls = 'danger') {
  return new Promise(res => {
    const o = openLayer(`<div class="lbl">${esc(title)}</div>${body}<div class="row"><button class="btn ghost grow" data-r="0">Cancel</button><button class="btn ${okCls} grow" data-r="1">${esc(okLabel)}</button></div>`, { cls: 'small', onClose: () => res(false) });
    o.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { closeLayer(o, true); res(b.dataset.r === '1'); } });
  });
}
function choose(title, body, options) {
  return new Promise(res => {
    const o = openLayer(`<div class="lbl">${esc(title)}</div>${body}<div class="col">${options.map(([v, l, c]) => `<button class="btn ${c || ''}" data-r="${esc(v)}">${l}</button>`).join('')}<button class="btn ghost" data-r="">Cancel</button></div>`, { cls: 'small', onClose: () => res(null) });
    o.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { closeLayer(o, true); res(b.dataset.r || null); } });
  });
}
function toast(msg, ms = 1900) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }

// ---------- files / thumbnails ----------
const urlCache = new Map();
const findAtt = id => (ui.edit?.d.atts || []).find(a => a.id === id) || S.items.flatMap(i => i.atts).find(a => a.id === id);
/** Thumbnail: offline cache first, else download from the private bucket (authenticated) and cache it. */
async function thumbURL(attId) {
  if (urlCache.has(attId)) return urlCache.get(attId);
  let blob = await Cache.blobGet(attId + ':t');
  if (!blob) {
    const a = findAtt(attId); if (!a || !M.isImage(a.type) || !cloud || isOffline()) return null;
    try { blob = await cloud.download(a.thumb || a.path); await Cache.blobPut(attId + ':t', blob); } catch { return null; }
  }
  const u = URL.createObjectURL(blob); urlCache.set(attId, u); return u;
}
function hydrateThumbs(root = document) {
  $$('img[data-thumb]:not([src])', root).forEach(async img => { const u = await thumbURL(img.dataset.thumb); if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'FILE' })); });
}
const firstImage = i => (i.atts || []).find(a => a.kind === 'photo' && /^image\//.test(a.type)) || (i.atts || []).find(a => /^image\//.test(a.type));
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}
const fileSafe = s => String(s || '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
async function addFiles(fileList, kind, target, itemId) {
  const added = [];
  if (readOnly()) { toast('Offline — connect to add photos or receipts'); return added; }
  for (const f of fileList) {
    if (!/^image\/|^application\/pdf$/.test(f.type) && !/\.(pdf|jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)) { toast(`Skipped ${f.name} (images or PDF only)`); continue; }
    const id = Store.uid('att'), blob = f.type ? f : new Blob([f], { type: /\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg' });
    const path = M.filePath(user.id, itemId, id); let thumb = null;
    try {
      const tb = await Files.makeThumb(blob);
      await cloud.upload(path, blob);
      if (tb) { thumb = M.thumbPath(path); await cloud.upload(thumb, tb); await Cache.blobPut(id + ':t', tb); }
      await Cache.blobPut(id, blob);
    } catch (e) { toast('Upload failed: ' + (e.message || e), 3000); continue; }
    const meta = { id, name: f.name || (kind === 'receipt' ? 'receipt' : 'photo'), type: blob.type, size: blob.size, kind, added: Date.now(), path, thumb };
    target.push(meta); added.push(id);
  }
  return added;
}
async function viewAtt(att) {
  // Online: short-lived signed URL from the private bucket. Offline: the cached copy, if this device has one.
  let url, dl, local = false;
  if (cloud && !isOffline()) {
    try { url = await cloud.signedUrl(att.path); dl = await cloud.signedUrl(att.path, { download: att.name }); } catch (e) { return toast('Could not open file: ' + (e.message || e)); }
  } else {
    const b = await Cache.blobGet(att.id); if (!b) return toast('Not available offline on this device');
    url = dl = URL.createObjectURL(b); local = true;
  }
  const rec = { blob: { type: att.type, size: att.size } }, isImg = M.isImage(att.type);
  openLayer(`<div class="sheet-h"><div class="title">${esc(att.name)}</div><button class="iconbtn" data-act="closeTop" aria-label="Close">✕</button></div>
    <div class="viewer">${isImg ? `<img src="${url}" alt="${esc(att.name)}">` : `<iframe src="${url}" title="${esc(att.name)}"></iframe>`}
    <div class="row wrap"><span class="hint grow">${esc(att.kind === 'receipt' ? 'Receipt' : 'Photo')} · ${esc(rec.blob.type || 'file')} · ${fmtSize(rec.blob.size)}</span>
    <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open ↗</a><a class="btn sm" href="${dl}" download="${esc(att.name)}">⤓ Save</a></div></div>`,
  { cls: 'wide', onClose: () => { if (local) setTimeout(() => URL.revokeObjectURL(url), 1000); } });
}

// ---------- render ----------
function render() {
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  renderDash();
  const v = $('#view');
  if (ui.view === 'gear') v.innerHTML = gearViewHTML();
  else if (ui.view === 'kits') v.innerHTML = kitsViewHTML();
  else if (ui.view === 'trips') v.innerHTML = ui.tripId && S.trips.some(t => t.id === ui.tripId) ? tripViewHTML() : tripsViewHTML();
  else v.innerHTML = dataViewHTML();
  if (ui.view === 'gear') renderGearList();
  if (ui.view === 'data') storageInfo();
  hydrateThumbs(v);
}

function renderDash() {
  const cur = S.settings.currency, live = S.items.filter(inService);
  let total = 0; const other = {};
  for (const i of live) { const v = C.unitValue(i); if (v == null) continue; const t = v * (i.qty || 1); if ((i.currency || cur) === cur) total += t; else other[i.currency] = (other[i.currency] || 0) + t; }
  const pieces = live.reduce((a, i) => a + (i.qty || 1), 0);
  const missing = live.filter(i => carnetErrs(i).length).length;
  const nextTrip = S.trips.filter(t => t.depart && t.depart >= today()).sort((a, b) => a.depart.localeCompare(b.depart))[0];
  const oth = Object.entries(other).map(([c, v]) => money(v, c, false)).join(' + ');
  $('#dash').innerHTML = `
    <div><div class="lbl">Gear items</div><div class="big">${live.length}</div><div class="sub">${plural(pieces, 'piece')} in service${S.items.length > live.length ? ` · ${S.items.length - live.length} sold/retired` : ''}</div></div>
    <div><div class="lbl">Total value</div><div class="big">${money(total, cur, false)}</div><div class="sub">${oth ? '+ ' + esc(oth) : 'current value, else purchase'}</div></div>
    <div class="${missing ? 'amber' : 'ok'}"><div class="lbl">Carnet-ready</div><div class="big ${missing ? 'amber' : 'teal'}">${live.length - missing}/${live.length}</div><div class="sub">${missing ? `${missing} missing serial/value/origin` : live.length ? 'all items complete' : 'add gear to start'}</div></div>
    <div><div class="lbl">Kits · Trips</div><div class="big">${S.kits.length} · ${S.trips.length}</div><div class="sub">${nextTrip ? `next: ${esc(nextTrip.name)} ${esc(nextTrip.depart)}` : 'road cases & carnet trips'}</div></div>`;
}

// ----- gear view -----
const EMPTY_GLYPH = `<svg class="glyph" viewBox="0 0 64 64" aria-hidden="true"><path d="M24 15v-4h16v4" fill="none" stroke="#00e5ff" stroke-width="2.4"/><rect x="6" y="15" width="52" height="38" rx="4" fill="none" stroke="#00e5ff" stroke-width="2.4"/><path d="M6 27h52" stroke="#00e5ff" stroke-width="1.4" opacity=".6"/><rect x="14" y="23" width="8" height="8" rx="1.5" fill="#05080f" stroke="#00e5ff" stroke-width="2"/><rect x="42" y="23" width="8" height="8" rx="1.5" fill="#05080f" stroke="#00e5ff" stroke-width="2"/><rect x="34" y="36" width="17" height="11" rx="2" fill="none" stroke="#ff3df2" stroke-width="2"/></svg>`;
function gearViewHTML() {
  if (!S.items.length) return `<div class="empty">${EMPTY_GLYPH}
    <h3>YOUR GEAR VAULT IS EMPTY</h3>
    <p>Log every laptop, rack PC, interface and cable with serials, receipts and photos — then group them into road cases and build an ATA Carnet general list for your next show abroad. Everything syncs privately to your own Supabase account behind a two-factor login.</p>
    <div class="lbl">Start with a category</div>
    <div class="chips">${S.settings.categories.map(c => `<button class="chip" data-act="newItem" data-cat="${esc(c)}">＋ ${esc(c)}</button>`).join('')}</div>
    <div class="row wrap" style="justify-content:center"><button class="btn primary" data-act="newItem">＋ Add first item</button><label class="btn ghost">⤒ Import CSV<input type="file" accept=".csv,text/csv" data-import="csv"></label><label class="btn ghost">⤒ Restore backup<input type="file" accept=".json,application/json" data-import="backup"></label></div>
  </div>`;
  const tags = [...new Set(S.items.flatMap(i => i.tags))].sort((a, b) => a.localeCompare(b));
  const cats = [...new Set([...S.settings.categories, ...S.items.map(i => i.category)])];
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  return `<div class="pane-h"><h2>Gear inventory</h2><div class="row"><button class="btn sm ghost" data-act="exportInvCSV">⤓ CSV</button><button class="btn sm primary" data-act="newItem">＋ Add gear</button></div></div>
  <div class="toolbar">
    <div class="search"><input id="q" class="inp" type="search" placeholder="Search name, make, model, serial, vendor, tag…" value="${esc(ui.q)}" autocomplete="off" aria-label="Search"></div>
    <select class="inp" data-filter="fCat" aria-label="Category">${opt('', 'All categories', ui.fCat)}${cats.map(c => opt(c, c, ui.fCat)).join('')}</select>
    <select class="inp" data-filter="fStatus" aria-label="Status">${opt('', 'Any status', ui.fStatus)}${opt('service', 'In service (active + repair)', ui.fStatus)}${Store.STATUSES.map(([k, l]) => opt(k, l, ui.fStatus)).join('')}</select>
    <select class="inp" data-filter="fTag" aria-label="Tag">${opt('', tags.length ? 'All tags' : 'No tags yet', ui.fTag)}${tags.map(t => opt(t, '#' + t, ui.fTag)).join('')}</select>
    <select class="inp" data-filter="sort" aria-label="Sort">${[['name', 'Sort: Name A–Z'], ['category', 'Sort: Category'], ['value', 'Sort: Value ↓'], ['date', 'Sort: Purchased ↓'], ['updated', 'Sort: Recently edited'], ['missing', 'Sort: Missing carnet data']].map(([k, l]) => opt(k, l, ui.sort)).join('')}</select>
  </div>
  <div id="gearList" class="list"></div>`;
}
function filteredItems() {
  const toks = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = S.items.filter(i => {
    if (ui.fCat && i.category !== ui.fCat) return false;
    if (ui.fStatus === 'service' ? !inService(i) : ui.fStatus && i.status !== ui.fStatus) return false;
    if (ui.fTag && !i.tags.includes(ui.fTag)) return false;
    if (toks.length) { const hay = [i.name, i.make, i.model, i.serial, i.vendor, i.notes, i.category, i.origin, ...i.tags, ...kitsOf(i.id).map(k => k.name)].join(' ').toLowerCase(); if (!toks.every(t => hay.includes(t))) return false; }
    return true;
  });
  const val = i => (C.unitValue(i) || 0) * (i.qty || 1), nm = i => itemTitle(i).toLowerCase();
  const cmp = { name: (a, b) => nm(a).localeCompare(nm(b)), category: (a, b) => a.category.localeCompare(b.category) || nm(a).localeCompare(nm(b)), value: (a, b) => val(b) - val(a),
    date: (a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''), updated: (a, b) => b.updated - a.updated, missing: (a, b) => carnetErrs(b).length - carnetErrs(a).length || nm(a).localeCompare(nm(b)) }[ui.sort];
  return list.sort(cmp);
}
function gearRowHTML(i) {
  const img = firstImage(i), v = C.unitValue(i), errs = carnetErrs(i), kits = kitsOf(i.id);
  const flags = errs.map(e => `<span class="flag">⚠ ${esc({ serial: 'serial', value: 'value', origin: 'origin', currency: i.currency }[e.k] || e.k)}</span>`).join('')
    + (i.atts.some(a => a.kind === 'receipt') ? '<span class="flag ok">🧾 receipt</span>' : '') + (i.status !== 'active' ? `<span class="badge ${i.status}">${i.status}</span>` : '');
  return `<button class="gear ${inService(i) ? '' : 'dimmed'}" data-act="editItem" data-id="${i.id}">
    <div class="thumb">${img ? `<img data-thumb="${img.id}" alt="">` : esc(catAbbr(i.category))}</div>
    <div style="min-width:0"><div class="g-name">${esc(itemTitle(i))}</div>
      <div class="g-mm">${esc([i.make, i.model].filter(Boolean).join(' ') || i.category)}</div>
      <div class="g-sn ${i.serial ? '' : 'none'}">${i.serial ? 'S/N ' + esc(i.serial) : 'no serial'}</div>
      ${flags ? `<div class="g-flags">${flags}</div>` : ''}</div>
    <div class="g-meta"><div>${esc(i.category)}</div><div class="row">${kits.map(k => `<span class="tag kit">▣ ${esc(k.name)}</span>`).join('')}${i.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>${i.origin ? `<div>Origin: ${esc(i.origin)}</div>` : ''}</div>
    <div class="g-val">${v == null ? '<span style="color:var(--amber)">—</span>' : money(v * (i.qty || 1), i.currency)}<small>${i.qty > 1 ? `${i.qty} × ${money(v, i.currency)}` : i.currentValue != null ? 'current value' : v != null ? 'purchase' : 'no value'}</small></div>
  </button>`;
}
function renderGearList() {
  const el = $('#gearList'); if (!el) return;
  const list = filteredItems(), cur = S.settings.currency;
  const total = list.reduce((a, i) => a + ((i.currency || cur) === cur ? (C.unitValue(i) || 0) * (i.qty || 1) : 0), 0);
  el.innerHTML = list.length ? list.map(gearRowHTML).join('') + `<div class="listfoot">${plural(list.length, 'item')} shown · ${money(total, cur)}${list.length !== S.items.length ? ` · ${S.items.length} total` : ''}</div>`
    : `<div class="empty" style="padding:28px"><p>No gear matches these filters.</p><button class="btn sm ghost" data-act="clearFilters">Clear filters</button></div>`;
  hydrateThumbs(el);
}

// ----- item editor -----
function openItemEditor(item, isNew = false) {
  const d = { ...item, atts: item.atts.map(a => ({ ...a })), tagsText: item.tags.join(', ') };
  ui.edit = { d, isNew, newAtts: [], pendingDel: [], kits: new Set(kitsOf(item.id).map(k => k.id)) };
  const st = S.settings, cats = [...new Set([...st.categories, d.category])];
  const f = (key, label, attrs = '', cls = '') => `<label class="fld ${cls}"><span>${label}</span><input class="inp" data-f="${key}" value="${esc(d[key] ?? '')}" ${attrs}></label>`;
  const need = key => (String(d[key] ?? '').trim() ? '' : 'need');
  const o = openLayer(`
    <div class="sheet-h"><div class="title">${isNew ? '＋ ADD GEAR' : 'EDIT GEAR'}</div><button class="iconbtn" data-act="cancelEdit" aria-label="Close">✕</button></div>
    <div class="section"><div class="lbl">Item</div><div class="grid4">
      ${f('name', 'Name / description *', 'placeholder="e.g. Show laptop A" autocomplete="off"', 'span2')}
      <label class="fld span2"><span>Category</span><select class="inp" data-f="category">${cats.map(c => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      ${f('make', 'Make', 'placeholder="Apple, Dell, Shure…" list="dl-makes" autocomplete="off"')}
      ${f('model', 'Model', 'placeholder="MacBook Pro 16&quot;" autocomplete="off"')}
      ${f('serial', 'Serial number(s) <b>● carnet</b>', 'placeholder="Separate several with commas" autocomplete="off" autocapitalize="characters"', 'span2 ' + need('serial'))}
      ${f('qty', 'Quantity / pieces', 'type="number" inputmode="numeric" min="1" step="1"')}
      <label class="fld"><span>Status</span><select class="inp" data-f="status">${Store.STATUSES.map(([k, l]) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div></div>
    <div class="section"><div class="lbl">Purchase &amp; value</div><div class="grid4">
      ${f('purchaseDate', 'Purchase date', 'type="date"')}
      ${f('price', 'Purchase price (each)', 'type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"')}
      <label class="fld"><span>Currency</span><select class="inp" data-f="currency">${[...new Set([d.currency, ...Store.CURRENCIES])].map(c => `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      ${f('vendor', 'Vendor', 'placeholder="Store / seller" list="dl-vendors" autocomplete="off"')}
      ${f('currentValue', 'Current value (each) — overrides price on carnets', 'type="number" inputmode="decimal" step="0.01" min="0" placeholder="Defaults to purchase price"', 'span2')}
      <p class="hint span2" style="align-self:center">Carnets need the <b>current fair market value</b>, not what you paid. Leave blank to use the purchase price.</p>
    </div></div>
    <div class="section"><div class="lbl">Carnet / customs</div><div class="grid4">
      ${f('origin', 'Country of origin <b>● carnet</b>', 'list="dl-countries" placeholder="Where it was made, e.g. China" autocomplete="off"', 'span2 ' + need('origin'))}
      <label class="fld span2"><span>Weight (each)</span><div class="joined"><input class="inp" data-f="weight" value="${esc(d.weight ?? '')}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.0"><select class="inp unit" data-f="weightUnit"><option value="kg" ${d.weightUnit === 'kg' ? 'selected' : ''}>kg</option><option value="lb" ${d.weightUnit === 'lb' ? 'selected' : ''}>lb</option></select></div></label>
    </div></div>
    <div class="section"><div class="row between wrap"><div class="lbl">Photos &amp; receipts</div><div class="row wrap">
      <label class="btn sm">📷 Add photo<input type="file" accept="image/*" multiple data-attkind="photo"></label>
      <label class="btn sm">🧾 Add receipt<input type="file" accept="image/*,application/pdf" multiple data-attkind="receipt"></label></div></div>
      <div id="attsBox"></div></div>
    <div class="section"><div class="lbl">Kits / road cases</div><div class="chips" id="kitChips">${S.kits.length ? S.kits.map(k => `<button class="chip ${ui.edit.kits.has(k.id) ? 'on' : ''}" data-act="toggleEditKit" data-id="${k.id}">▣ ${esc(k.name)}</button>`).join('') : '<span class="hint">No kits yet — create road cases in the Kits tab.</span>'}</div></div>
    <div class="section"><div class="lbl">Tags &amp; notes</div>
      <label class="fld"><span>Tags (comma separated)</span><input class="inp" data-f="tagsText" value="${esc(d.tagsText)}" placeholder="millumin, playback, spare" autocomplete="off"></label>
      <label class="fld"><span>Notes</span><textarea class="inp" data-f="notes" placeholder="Specs, warranty, AppleCare, what's installed…">${esc(d.notes)}</textarea></label></div>
    ${dataLists()}
    <div class="sheet-f">${isNew ? '' : '<button class="btn danger" data-act="deleteItem">Delete</button><button class="btn ghost" data-act="dupItem">Duplicate</button>'}<span class="grow"></span><button class="btn ghost" data-act="cancelEdit">Cancel</button><button class="btn primary" data-act="saveItem">Save</button></div>`,
  { cls: 'wide', backdrop: false, onClose: () => discardEdit() });
  renderAtts();
  if (isNew) $('[data-f=name]', o)?.focus({ preventScroll: true });
}
function dataLists() {
  const uniq = k => [...new Set(S.items.map(i => i[k]).filter(Boolean))].sort();
  return `<datalist id="dl-countries">${[...new Set([...uniq('origin'), ...Store.COUNTRIES])].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dl-makes">${[...new Set([...uniq('make'), 'Apple', 'Dell', 'HP', 'Lenovo', 'Microsoft', 'ASUS', 'Blackmagic Design', 'Focusrite', 'RME', 'MOTU', 'Shure', 'Sennheiser', 'Behringer', 'Allen & Heath', 'Yamaha', 'Starlink', 'Ubiquiti', 'Netgear', 'CalDigit', 'OWC', 'Anker', 'Samsung', 'LG', 'Pelican', 'SKB', 'Gator'])].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dl-vendors">${uniq('vendor').map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
}
function renderAtts() {
  const box = $('#attsBox'); if (!box || !ui.edit) return;
  const atts = ui.edit.d.atts;
  box.innerHTML = atts.length ? `<div class="atts">${atts.map(a => `<div class="att" data-act="viewAtt" data-id="${a.id}" role="button" tabindex="0">
      <div class="ai">${/^image\//.test(a.type) ? `<img data-thumb="${a.id}" alt="">` : 'PDF'}</div>
      <div class="ak ${a.kind}">${a.kind}</div><div class="an">${esc(a.name)}</div><small class="hint">${fmtSize(a.size)}</small>
      <button class="x" data-act="removeAtt" data-id="${a.id}" aria-label="Remove ${esc(a.name)}">✕</button></div>`).join('')}</div>`
    : '<p class="hint">No files yet. Snap the serial-number label and the receipt — on iPhone/iPad the buttons open the camera or Photos. PDFs work for receipts.</p>';
  hydrateThumbs(box);
}
function discardEdit() {
  if (!ui.edit) return;
  const gone = ui.edit.d.atts.concat(ui.edit.removed || []).filter(a => ui.edit.newAtts.includes(a.id));
  if (cloud) cloud.removeFiles(gone.flatMap(a => [a.path, a.thumb]).filter(Boolean));
  ui.edit = null;
}
function saveEdit() {
  const E = ui.edit; if (!E) return;
  if (readOnly()) return toast('Offline — reconnect to save');
  const d = E.d;
  if (!String(d.name || '').trim() && !String(d.make || '').trim() && !String(d.model || '').trim()) { toast('Give it a name (or make / model)'); $('[data-f=name]')?.focus(); return; }
  const item = Store.sanitizeItem({ ...d, tags: Store.splitTags(d.tagsText), updated: Date.now() }, S.settings);
  delete item.tagsText;
  const ix = S.items.findIndex(i => i.id === item.id);
  if (ix >= 0) S.items[ix] = item; else S.items.push(item);
  if (!S.settings.categories.includes(item.category)) S.settings.categories.push(item.category);
  for (const k of S.kits) {
    const has = k.itemIds.includes(item.id), want = E.kits.has(k.id);
    if (want && !has) k.itemIds.push(item.id); if (!want && has) k.itemIds = k.itemIds.filter(x => x !== item.id);
  }
  // Files added and removed in this same edit were never saved: delete them now. Everything else is removed by the sync.
  const orphan = (E.removed || []).filter(a => E.newAtts.includes(a.id)); if (orphan.length) cloud.removeFiles(orphan.flatMap(a => [a.path, a.thumb]).filter(Boolean));
  for (const id of E.pendingDel) urlCache.delete(id);
  ui.edit = null; persist(); closeLayer(undefined, true); render();
  toast(E.isNew ? `Added “${itemTitle(item)}”` : 'Saved');
}

// ----- kits -----
function kitStats(k) {
  const items = k.itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean), cur = S.settings.currency;
  return { items, pieces: items.reduce((a, i) => a + (i.qty || 1), 0), value: items.reduce((a, i) => a + ((i.currency || cur) === cur ? (C.unitValue(i) || 0) * (i.qty || 1) : 0), 0),
    kg: items.reduce((a, i) => a + (C.toKg(i.weight, i.weightUnit) || 0) * (i.qty || 1), 0), missing: items.filter(i => carnetErrs(i).length).length };
}
function kitsViewHTML() {
  const wu = S.settings.weightUnit, cur = S.settings.currency;
  return `<div class="pane-h"><h2>Kits &amp; road cases</h2><button class="btn sm primary" data-act="newKit">＋ New kit</button></div>
  <p class="hint">Group gear into the cases and bags you actually travel with (e.g. “Rack A”, “Laptop bag”). A trip can then pull in whole kits at once. Add the case itself as a gear item if it should appear on the carnet.</p>
  ${S.kits.length ? `<div class="cards">${S.kits.map(k => { const s = kitStats(k); return `<button class="kcard" data-act="editKit" data-id="${k.id}">
    <span class="k-type">${esc(k.type)}</span><span class="k-name">${esc(k.name)}</span>
    <span class="k-stats"><span>${plural(s.items.length, 'item')}</span><span>${s.pieces} pcs</span><span>${money(s.value, cur, false)}</span><span>${fmtW(s.kg, wu)}</span></span>
    <span class="k-list">${s.items.length ? s.items.map(i => esc(itemTitle(i))).join(' · ') : 'Empty — tap to add gear'}</span>
    ${s.missing ? `<span class="flag">⚠ ${s.missing} missing carnet data</span>` : s.items.length ? '<span class="flag ok">✓ carnet data complete</span>' : ''}</button>`; }).join('')}</div>`
    : `<div class="empty" style="padding:30px">${EMPTY_GLYPH}<p>No kits yet. Typical setups: <b>Rack A</b>, <b>Laptop bag</b>, <b>Audio case</b>, <b>Network kit</b>.</p><button class="btn primary" data-act="newKit">＋ Create first kit</button></div>`}`;
}
function pickerHTML(selected, listName) {
  const items = S.items.slice().sort((a, b) => (inService(b) - inService(a)) || itemTitle(a).localeCompare(itemTitle(b)));
  if (!items.length) return '<p class="hint">No gear yet — add items in the Gear tab first.</p>';
  return `<div class="search"><input class="inp" type="search" data-pickfilter placeholder="Filter ${items.length} items…" autocomplete="off"></div>
  <div class="picker" data-list="${listName}">${items.map(i => `<label class="pick ${selected.has(i.id) ? 'on' : ''}" data-s="${esc([itemTitle(i), i.make, i.model, i.serial, i.category, ...i.tags].join(' ').toLowerCase())}">
    <input type="checkbox" value="${i.id}" ${selected.has(i.id) ? 'checked' : ''}><span class="pn">${esc(itemTitle(i))}<small>${esc(i.serial || '')}</small></span><span class="pv">${esc(i.category)}${inService(i) ? '' : ' · ' + i.status}</span></label>`).join('')}</div>`;
}
function openKitEditor(kit, isNew) {
  const o = openLayer(`<div class="sheet-h"><div class="title">${isNew ? '＋ NEW KIT' : 'EDIT KIT'}</div><button class="iconbtn" data-act="closeTop" aria-label="Close">✕</button></div>
    <div class="grid3"><label class="fld span2"><span>Kit / case name *</span><input class="inp" id="kName" value="${esc(kit.name)}" placeholder="Rack A" autocomplete="off"></label>
    <label class="fld"><span>Type</span><select class="inp" id="kType">${[...new Set([kit.type, ...Store.KIT_TYPES])].map(t => `<option ${t === kit.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Notes</span><textarea class="inp" id="kNotes" placeholder="Case dimensions, ATA case serial, packing notes…">${esc(kit.notes)}</textarea></label>
    <div class="lbl">Contents</div>${pickerHTML(new Set(kit.itemIds), 'kit')}
    <div class="sheet-f">${isNew ? '' : '<button class="btn danger" data-act="deleteKit">Delete kit</button>'}<span class="grow"></span><button class="btn ghost" data-act="closeTop">Cancel</button><button class="btn primary" data-act="saveKit">Save kit</button></div>`, { cls: 'wide', backdrop: false });
  o._kit = kit; o._isNew = isNew;
  if (isNew) { const n = $('#kName', o); n.focus({ preventScroll: true }); n.select(); }
}
const pickedIds = o => { const sel = new Set($$('.picker input:checked', o).map(x => x.value)); return S.items.map(i => i.id).filter(id => sel.has(id)); };

// ----- trips -----
function tripsViewHTML() {
  return `<div class="pane-h"><h2>Trips &amp; ATA Carnet</h2><button class="btn sm primary" data-act="newTrip">＋ New trip</button></div>
  <p class="note">An <b>ATA Carnet</b> lets you temporarily export professional equipment duty-free. Build a trip from your kits, fix anything flagged, then print the <b>General List</b> or export CSV for your carnet application. Values must be <b>current fair market value</b>.</p>
  ${S.trips.length ? `<div class="cards">${S.trips.slice().sort((a, b) => (b.depart || '').localeCompare(a.depart || '')).map(t => { const gl = C.buildGeneralList(S, t); return `<button class="kcard" data-act="openTrip" data-id="${t.id}">
    <span class="k-type">${esc(t.destinations || 'Destination TBD')}</span><span class="k-name">${esc(t.name)}</span>
    <span class="hint">${esc([t.depart, t.ret].filter(Boolean).join(' → ') || 'Dates TBD')}${t.carnetNo ? ' · Carnet ' + esc(t.carnetNo) : ''}</span>
    <span class="k-stats"><span>${plural(gl.totals.lines, 'line')}</span><span>${gl.totals.pieces} pcs</span><span>${money(gl.totals.value, gl.currency, false)}</span><span>${num2(gl.totals.weight)} ${gl.weightUnit}</span></span>
    ${gl.totals.errors ? `<span class="flag">⚠ ${gl.totals.errors} line${gl.totals.errors > 1 ? 's' : ''} need attention</span>` : gl.totals.lines ? '<span class="flag ok">✓ ready to export</span>' : '<span class="hint">No gear yet</span>'}</button>`; }).join('')}</div>`
    : `<div class="empty" style="padding:30px">${EMPTY_GLYPH}<p>No trips yet. Create one for your next international show — e.g. <b>“Corporate GS — London”</b>.</p><button class="btn primary" data-act="newTrip">＋ New trip</button></div>`}`;
}
const trip = () => S.trips.find(t => t.id === ui.tripId);
function tripViewHTML() {
  const t = trip(), tf = (k, label, attrs = '', cls = '') => `<label class="fld ${cls}"><span>${label}</span><input class="inp" data-tf="${k}" value="${esc(t[k] ?? '')}" ${attrs}></label>`;
  const indiv = t.itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean);
  return `<div class="pane-h"><div class="row wrap"><button class="btn sm ghost" data-act="backTrips">← Trips</button><h2 id="tripTitle">${esc(t.name)}</h2></div>
    <div class="row wrap"><button class="btn sm ghost" data-act="deleteTrip">Delete</button><button class="btn sm" data-act="csvCarnet">⤓ CSV</button><button class="btn sm mag" data-act="previewCarnet">▤ General List / Print</button></div></div>
  <div class="trip-grid">
    <div class="trip-side">
      <div class="card"><div class="lbl">Trip details</div>
        ${tf('name', 'Trip / event name', 'autocomplete="off"')}
        ${tf('destinations', 'Destination countries', 'list="dl-dest" placeholder="United Kingdom, France" autocomplete="off"')}
        <datalist id="dl-dest">${Store.COUNTRIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="grid2">${tf('depart', 'Depart', 'type="date"')}${tf('ret', 'Return', 'type="date"')}</div>
        <div class="grid2">${tf('holder', 'Carnet holder', 'placeholder="Your name / company" autocomplete="off"')}${tf('carnetNo', 'Carnet no. (if issued)', 'autocomplete="off"')}</div>
        ${tf('purpose', 'Intended use', 'placeholder="Professional equipment"')}
        <div class="grid2"><label class="fld"><span>Carnet currency</span><select class="inp" data-tf="currency">${[...new Set([t.currency, ...Store.CURRENCIES])].map(c => `<option ${c === t.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="fld"><span>Weight unit</span><select class="inp" data-tf="weightUnit"><option value="kg" ${t.weightUnit === 'kg' ? 'selected' : ''}>kg</option><option value="lb" ${t.weightUnit === 'lb' ? 'selected' : ''}>lb</option></select></label></div>
        <label class="tgl"><input type="checkbox" data-tf="serialInDesc" ${t.serialInDesc ? 'checked' : ''}> Also put serial numbers in the description</label>
      </div>
      <div class="card"><div class="row between"><div class="lbl">Kits on this trip</div><span class="hint">tap to toggle</span></div>
        <div class="chips">${S.kits.length ? S.kits.map(k => `<button class="chip ${t.kitIds.includes(k.id) ? 'on' : ''}" data-act="toggleTripKit" data-id="${k.id}">▣ ${esc(k.name)} <small>${k.itemIds.length}</small></button>`).join('') : '<span class="hint">No kits yet — make them in the Kits tab, or add items individually.</span>'}</div></div>
      <div class="card"><div class="row between"><div class="lbl">Individual items</div><button class="btn sm" data-act="pickTripItems">＋ Add items</button></div>
        ${indiv.length ? `<div class="col">${indiv.map(i => `<div class="row between"><span class="grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(itemTitle(i))}</span><button class="iconbtn" data-act="removeTripItem" data-id="${i.id}" aria-label="Remove">✕</button></div>`).join('')}</div>` : '<p class="hint">Gear not in a kit (e.g. a laptop in your backpack).</p>'}</div>
    </div>
    <div id="tripLines" class="col">${tripLinesHTML()}</div>
  </div>`;
}
function issueLabel(x) { return { serial: 'no serial', value: 'no value', origin: 'no origin', weight: 'no weight' }[x.k] || x.msg; }
function tripLinesHTML() {
  const t = trip(), gl = C.buildGeneralList(S, t), cur = gl.currency;
  const excl = (t.excluded || []).map(id => S.items.find(i => i.id === id)).filter(Boolean);
  const c = gl.counts, parts = [c.serial && `${c.serial} missing serial`, c.value && `${c.value} missing value`, c.origin && `${c.origin} missing country of origin`, c.currency && `${c.currency} in another currency`].filter(Boolean);
  return `<div class="hud-stat"><div><div class="lbl">Lines</div><div class="big">${gl.totals.lines}</div></div><div><div class="lbl">Pieces</div><div class="big">${gl.totals.pieces}</div></div>
    <div><div class="lbl">Weight</div><div class="big">${num2(gl.totals.weight)}<span style="font-size:13px"> ${gl.weightUnit}</span></div></div><div><div class="lbl">Value</div><div class="big">${money(gl.totals.value, cur, false)}</div></div></div>
  ${gl.totals.errors ? `<p class="note amber" id="carnetIssues">⚠ <b>${plural(gl.totals.errors, 'line')} need attention before export:</b> ${esc(parts.join(', '))}. Tap <b>Fix</b> on a row to edit the item.</p>`
    : gl.totals.lines ? '<p class="note" id="carnetIssues">✓ Every line has a serial number, value and country of origin.</p>' : ''}
  <p class="hint">Value column = <b>current value</b> if set on the item, otherwise purchase price, × pieces, in ${esc(cur)}. Customs expects current fair market value.</p>
  ${gl.lines.length ? `<div class="tablewrap"><table class="ro carnet"><thead><tr><th class="n">#</th><th>Trade description</th><th>Serial</th><th class="n">Pcs</th><th class="n">Wt ${gl.weightUnit}</th><th class="n">Value</th><th>Origin</th><th></th></tr></thead><tbody>
    ${gl.lines.map(l => { const errs = l.issues.filter(x => x.level === 'err'); return `<tr class="${errs.length ? 'bad' : ''}">
      <td class="n no">${l.no}</td><td class="desc">${esc(l.description)}${l.kit ? `<div class="kitname">▣ ${esc(l.kit)}</div>` : ''}${l.issues.length ? `<div class="issues">${l.issues.map(x => `<span class="flag ${x.level === 'err' ? '' : 'warn'}">${esc(issueLabel(x))}</span>`).join('')}</div>` : ''}</td>
      <td class="mono" data-l="S/N">${esc(l.serial) || '—'}</td><td class="n" data-l="Pcs">${l.pieces}</td><td class="n" data-l="${gl.weightUnit}">${num2(l.weight)}</td><td class="n" data-l="${esc(cur)}">${l.value == null ? '—' : num2(l.value)}${l.currency !== cur ? ` <small>${esc(l.currency)}</small>` : ''}</td><td data-l="Origin">${esc(l.origin) || '—'}</td>
      <td class="act" style="white-space:nowrap">${errs.length ? `<button class="btn sm" data-act="editItem" data-id="${l.itemId}">Fix</button>` : `<button class="iconbtn" data-act="editItem" data-id="${l.itemId}" aria-label="Edit">✎</button>`}<button class="iconbtn" data-act="excludeLine" data-id="${l.itemId}" aria-label="Leave off this trip" title="Leave off this trip">✕</button></td></tr>`; }).join('')}
    </tbody><tfoot><tr><td class="no"></td><td class="desc">TOTAL</td><td class="mono"></td><td class="n" data-l="Pcs">${gl.totals.pieces}</td><td class="n" data-l="${gl.weightUnit}">${num2(gl.totals.weight)}</td><td class="n" data-l="${esc(cur)}">${num2(gl.totals.value)}</td><td colspan="2" class="hide-m">${esc(cur)}</td></tr></tfoot></table></div>`
    : '<div class="empty" style="padding:24px"><p>Pick kits or add individual items to build the general list.</p></div>'}
  ${excl.length ? `<div class="card"><div class="lbl">Left off this trip</div><div class="chips">${excl.map(i => `<button class="chip" data-act="restoreLine" data-id="${i.id}">↺ ${esc(itemTitle(i))}</button>`).join('')}</div></div>` : ''}`;
}
function refreshTripLines() { const el = $('#tripLines'); if (el) el.innerHTML = tripLinesHTML(); renderDash(); }

function paperHTML(t) {
  const gl = C.buildGeneralList(S, t), cur = gl.currency;
  return `<div class="paperbar"><span class="t">ATA CARNET · GENERAL LIST</span>${gl.totals.errors ? `<span class="flag">⚠ ${gl.totals.errors} incomplete line${gl.totals.errors > 1 ? 's' : ''} (highlighted)</span>` : ''}
    <button class="btn sm primary" data-act="printCarnet">🖨 Print / Save PDF</button><button class="btn sm" data-act="csvCarnet">⤓ CSV</button><button class="btn sm ghost" data-act="closePaper">✕ Close</button></div>
  <div class="paper">
    <div class="ph"><div><h1>GENERAL LIST</h1><div class="sm">ATA Carnet — list of goods for temporary admission · ${esc(t.purpose || 'Professional equipment')}</div></div>
      <div class="sm" style="text-align:right">Carnet No.: <b>${esc(t.carnetNo) || '____________________'}</b><br>Holder: <b>${esc(t.holder) || '____________________'}</b></div></div>
    <div class="meta"><div><b>Trip / event</b>${esc(t.name)}</div><div><b>Destination country(ies)</b>${esc(t.destinations) || '—'}</div><div><b>Dates of travel</b>${esc([t.depart, t.ret].filter(Boolean).join(' to ')) || '—'}</div>
      <div><b>Currency of values</b>${esc(cur)} — current fair market value</div><div><b>Weight unit</b>${gl.weightUnit === 'lb' ? 'pounds (lb)' : 'kilograms (kg)'}</div><div><b>Total</b>${gl.totals.lines} lines · ${gl.totals.pieces} pieces</div></div>
    <table><thead><tr><th class="c" style="width:5%">Item No.</th><th style="width:37%">Trade description of goods (make, model, description)</th><th style="width:17%">Serial number</th><th class="c" style="width:7%">No. of pieces</th><th class="n" style="width:9%">Weight (${gl.weightUnit})</th><th class="n" style="width:12%">Value (${esc(cur)})</th><th style="width:13%">Country of origin</th></tr></thead>
    <tbody>${gl.lines.map(l => { const m = k => (l.issues.some(x => x.k === k && x.level === 'err') ? ' miss' : ''); return `<tr><td class="c">${l.no}</td><td>${esc(l.description)}</td><td class="sn${m('serial')}">${esc(l.serial) || '—'}</td><td class="c">${l.pieces}</td><td class="n">${l.weight == null ? '—' : num2(l.weight)}</td><td class="n${m('value')}${m('currency')}">${l.value == null ? '—' : num2(l.value)}${l.currency !== cur ? ' ' + esc(l.currency) : ''}</td><td class="${m('origin').trim()}">${esc(l.origin) || '—'}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td></td><td>GRAND TOTAL</td><td></td><td class="c">${gl.totals.pieces}</td><td class="n">${num2(gl.totals.weight)}</td><td class="n">${num2(gl.totals.value)}</td><td>${esc(cur)}</td></tr></tfoot></table>
    <div class="foot"><div>Values stated are current fair market values in ${esc(cur)}. Serial numbers are as marked on the goods. All goods are professional equipment for use by the holder and will be re-exported.<br>Prepared ${esc(today())} with ShowCrew GearVault.</div><div class="sig">Holder / authorized representative — signature &amp; date</div></div>
  </div>`;
}
function showPaper() { const t = trip(); if (!t) return; const p = $('#printRoot'); p.innerHTML = paperHTML(t); p.classList.add('show'); p.setAttribute('aria-hidden', 'false'); p.scrollTop = 0; }
function closePaper() { const p = $('#printRoot'); p.classList.remove('show'); p.setAttribute('aria-hidden', 'true'); }
async function guardExport(what) {
  const gl = C.buildGeneralList(S, trip());
  if (!gl.lines.length) { toast('Nothing on this trip yet'); return false; }
  if (!gl.totals.errors) return true;
  const c = gl.counts, li = [c.serial && `${c.serial} without a serial number`, c.value && `${c.value} without a value`, c.origin && `${c.origin} without a country of origin`, c.currency && `${c.currency} valued in another currency`].filter(Boolean);
  return confirmBox(`${plural(gl.totals.errors, 'line')} incomplete`, `${what} anyway`, `<p class="warn">Customs and carnet issuers expect every line to have these. Missing:</p><ul class="hint">${li.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`, 'primary');
}
async function exportCarnetCSV() {
  const t = trip(); if (!(await guardExport('Export'))) return;
  const gl = C.buildGeneralList(S, t);
  download(`Carnet_General_List_${fileSafe(t.name)}.csv`, new Blob([C.generalListCSV(gl, t)], { type: 'text/csv;charset=utf-8' }));
  toast('General list CSV exported');
}
async function printCarnet() {
  const t = trip(); if (!(await guardExport('Print'))) return;
  showPaper(); const old = document.title; document.title = `Carnet General List – ${t.name}`;
  setTimeout(() => { window.print(); document.title = old; }, 60);
}

// ----- data view -----
function dataViewHTML() {
  const st = S.settings, nAtt = S.items.reduce((a, i) => a + i.atts.length, 0), used = new Map();
  S.items.forEach(i => used.set(i.category, (used.get(i.category) || 0) + 1));
  const legacy = Store.loadLegacy(), lf = legacyFlag();
  return `<div class="pane-h"><h2>Data &amp; settings</h2><span class="hint">v${APP_VERSION} · synced to your Supabase account</span></div>
  <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
    <div class="card" id="accountCard"><div class="lbl">Account</div>
      <p class="hint">Signed in as <b>${esc(user?.email || '—')}</b><br>Two-factor (TOTP): <b>required</b> ✓ — data is only readable at MFA level aal2.</p>
      <p class="hint">${isOffline() ? 'Offline: showing the copy cached on this device. Editing is disabled until you reconnect.' : syncErr ? '⚠ Last save failed: ' + esc(syncErr.message || syncErr) : 'All changes save to the cloud automatically.'}</p>
      <div class="row wrap"><button class="btn sm" data-act="refreshNow">↻ Refresh from cloud</button><button class="btn sm ghost" data-act="signOut">Sign out</button></div>
      <p class="hint">Signing out also removes the offline copy from this browser.</p></div>
    ${legacy && (legacy.items.length || legacy.kits.length || legacy.trips.length) ? `<div class="card" id="legacyCard"><div class="lbl">On-device gear (v1)</div>
      <p class="hint">This browser still holds GearVault v1 data that lived only on this device: ${plural(legacy.items.length, 'item')}, ${plural(legacy.kits.length, 'kit')}, ${plural(legacy.trips.length, 'trip')}.</p>
      ${lf && user && lf.uid === user.id ? `<p class="note">✓ Uploaded to the cloud ${esc(new Date(lf.at).toLocaleString())}. Check your gear, then remove the local copy.</p>
        <div class="row wrap"><button class="btn sm" data-act="uploadLegacy">Upload again</button><button class="btn sm danger" data-act="deleteLegacy">Delete on-device copy</button></div>`
        : '<div class="row wrap"><button class="btn sm primary" data-act="uploadLegacy">☁ Upload my on-device gear to the cloud</button></div>'}</div>` : ''}
    <div class="card"><div class="lbl">Full backup</div>
      <p class="hint">One JSON file with all gear, kits, trips, settings <b>and every photo/receipt</b> (base64), downloaded from the cloud. Keep a copy somewhere safe (iCloud Drive / Files). Restore merges into, or replaces, your cloud data.</p>
      <p class="hint">${plural(S.items.length, 'item')} · ${plural(S.kits.length, 'kit')} · ${plural(S.trips.length, 'trip')} · ${plural(nAtt, 'file')}</p>
      <div class="row wrap"><button class="btn primary" data-act="exportBackup">⤓ Export backup</button><label class="btn">⤒ Restore backup<input type="file" accept=".json,application/json" data-import="backup"></label></div></div>
    <div class="card"><div class="lbl">Inventory spreadsheet (CSV)</div>
      <p class="hint">Opens in Excel / Numbers / Google Sheets. Import matches rows by <b>id</b> (updates) or adds new items. Recognized headers include name, category, make, model, serial, qty, purchase_price, current_value, currency, vendor, country_of_origin, weight, weight_unit, status, tags, notes.</p>
      <div class="row wrap"><button class="btn" data-act="exportInvCSV">⤓ Export CSV</button><label class="btn">⤒ Import CSV<input type="file" accept=".csv,text/csv" data-import="csv"></label><button class="btn ghost" data-act="csvTemplate">Template</button></div></div>
    <div class="card"><div class="lbl">Defaults</div><div class="grid2">
      <label class="fld"><span>Currency</span><select class="inp" data-set="currency">${[...new Set([st.currency, ...Store.CURRENCIES])].map(c => `<option ${c === st.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="fld"><span>Weight unit</span><select class="inp" data-set="weightUnit"><option value="kg" ${st.weightUnit === 'kg' ? 'selected' : ''}>kg</option><option value="lb" ${st.weightUnit === 'lb' ? 'selected' : ''}>lb</option></select></label>
      <label class="fld span2"><span>Carnet holder (pre-fills new trips)</span><input class="inp" data-set="holder" value="${esc(st.holder)}" placeholder="Name / company"></label></div>
      <p class="hint">Used for new items and new trips; dashboard totals use the default currency.</p></div>
    <div class="card"><div class="row between"><div class="lbl">Categories</div><button class="btn sm" data-act="addCategory">＋ Add</button></div>
      <div class="col">${st.categories.map((c, ix) => `<div class="row"><input class="inp" data-cat-ix="${ix}" value="${esc(c)}" aria-label="Category name"><span class="hint" style="min-width:34px;text-align:right">${used.get(c) || 0}</span><button class="iconbtn" data-act="delCategory" data-ix="${ix}" aria-label="Delete category">✕</button></div>`).join('')}</div>
      <p class="hint">Renaming updates every item in that category. Deleting moves its items to “Other”.</p></div>
    <div class="card"><div class="lbl">Offline copy on this device</div><p class="hint" id="storageInfo">Checking…</p>
      <p class="hint">GearVault caches your last synced data and the photos you've viewed so it opens read-only without a connection.</p>
      <div class="row wrap"><button class="btn sm" data-act="persistStorage">Keep offline copy persistent</button></div></div>
    <div class="card"><div class="lbl">Danger zone</div><p class="hint">Erase all gear, kits, trips, photos and receipts from your cloud account (every device). Export a backup first.</p><button class="btn danger" data-act="eraseAll">Erase everything…</button></div>
  </div>`;
}
async function storageInfo() {
  const el = $('#storageInfo'); if (!el) return;
  try {
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null, per = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    el.innerHTML = (est ? `Using <b>${fmtSize(est.usage || 0)}</b> of ~${fmtSize(est.quota || 0)} available. ` : '') + (per ? '✓ Persistent storage granted.' : 'Not marked persistent — install to Home Screen and/or tap below, and keep backups.');
  } catch { el.textContent = 'Storage info unavailable.'; }
}
async function exportBackup() {
  toast('Packing backup…');
  const files = {}; let missing = 0;
  for (const i of S.items) for (const a of i.atts) {
    let blob = await Cache.blobGet(a.id);
    if (!blob && cloud && !isOffline()) { try { blob = await cloud.download(a.path); await Cache.blobPut(a.id, blob); } catch { blob = null; } }
    if (blob) files[a.id] = { name: a.name, type: blob.type || a.type, data: await Files.blobToDataURL(blob) }; else missing++;
  }
  const json = JSON.stringify({ app: 'ShowCrew GearVault', format: 2, version: APP_VERSION, exported: new Date().toISOString(), data: S, files });
  download(`GearVault_backup_${today()}.json`, new Blob([json], { type: 'application/json' }));
  toast(`Backup exported (${fmtSize(json.length)})${missing ? ` · ${missing} file(s) missing` : ''}`, 2600);
}
async function importBackup(file) {
  let obj; try { obj = JSON.parse(await file.text()); } catch { return toast('That file is not valid JSON'); }
  let st; try { st = Store.sanitizeState(obj.data || obj); } catch (e) { return toast('Import failed: ' + e.message); }
  const files = obj.files || {}, nF = Object.keys(files).length;
  if (readOnly()) return toast('Offline — connect to restore a backup');
  const mode = await choose('Restore backup', `<p class="hint">${plural(st.items.length, 'item')}, ${plural(st.kits.length, 'kit')}, ${plural(st.trips.length, 'trip')}, ${plural(nF, 'file')}${obj.exported ? ` · exported ${esc(obj.exported.slice(0, 10))}` : ''}.</p>`,
    [['merge', 'Merge into my cloud data', 'primary'], ['replace', 'Replace ALL my cloud data with this backup', 'danger']]);
  if (!mode) return;
  const r = await bringIn(st, id => (files[id] ? Files.dataURLToBlob(files[id].data) : null), mode);
  toast(`Restored ${plural(st.items.length, 'item')}${nF ? ` + ${r.files} files` : ''}${r.bad ? ` (${r.bad} failed)` : ''}`, 2600);
}
/** Merge or replace cloud data with `st` (from a backup or v1 on-device data). getBlob(oldAttId) → Blob|null|Promise. */
async function bringIn(st, getBlob, mode = 'merge') {
  toast('Uploading to the cloud…', 4000); renderBadge('saving');
  const map = await M.remapIds(st, user.id), back = new Map([...map].map(([o, n]) => [n, o]));
  let files = 0, bad = 0;
  for (const i of st.items) for (const a of i.atts.slice()) {
    try {
      const blob = await getBlob(back.get(a.id) || a.id);
      if (!blob) { i.atts = i.atts.filter(x => x !== a); bad++; continue; }
      a.type = blob.type || a.type; a.size = blob.size; a.path = M.filePath(user.id, i.id, a.id); a.thumb = null;
      await cloud.upload(a.path, blob); await Cache.blobPut(a.id, blob);
      const tb = await Files.makeThumb(blob);
      if (tb) { a.thumb = M.thumbPath(a.path); await cloud.upload(a.thumb, tb); await Cache.blobPut(a.id + ':t', tb); }
      urlCache.delete(a.id); files++;
    } catch (e) { console.warn('file upload failed', e); i.atts = i.atts.filter(x => x !== a); bad++; }
  }
  if (mode === 'replace') S = st;
  else {
    const up = (arr, x) => { const ix = arr.findIndex(y => y.id === x.id); if (ix >= 0) arr[ix] = x; else arr.push(x); };
    st.items.forEach(x => up(S.items, x)); st.kits.forEach(x => up(S.kits, x)); st.trips.forEach(x => up(S.trips, x));
    S.settings.categories = [...new Set([...S.settings.categories, ...st.settings.categories])];
  }
  ui.tripId = null; render();
  clearTimeout(syncT); await runSync();
  return { files, bad, ok: !syncErr };
}
async function importCSV(file) {
  if (readOnly()) return toast('Offline — connect to import');
  let rows; try { rows = C.parseInventoryCSV(await file.text()); } catch (e) { return toast('CSV import failed: ' + e.message, 3000); }
  let added = 0, updated = 0;
  for (const o of rows) {
    if (o.weightUnit) o.weightUnit = /^lb/i.test(o.weightUnit) ? 'lb' : 'kg';
    const ex = o.id && S.items.find(i => i.id === o.id);
    if (ex) { const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '')); Object.assign(ex, Store.sanitizeItem({ ...ex, ...clean, atts: ex.atts, updated: Date.now() }, S.settings)); updated++; }
    else { const it = Store.sanitizeItem({ ...o, id: o.id && M.UUID_RE.test(o.id) ? o.id : undefined, category: o.category || 'Other' }, S.settings); if (S.items.some(i => i.id === it.id)) it.id = Store.uid('itm'); S.items.push(it); added++; }
  }
  for (const i of S.items) if (!S.settings.categories.includes(i.category)) S.settings.categories.push(i.category);
  persist(); render(); toast(`CSV: ${added} added, ${updated} updated`, 2400);
}

// ---------- actions ----------
const legacyFlag = () => { try { return JSON.parse(localStorage.getItem(Store.LEGACY_UPLOADED_KEY) || 'null'); } catch { return null; } };
async function offerLegacyUpload(force = false) {
  const legacy = Store.loadLegacy(); if (!legacy || !(legacy.items.length || legacy.kits.length || legacy.trips.length) || readOnly()) return;
  const lf = legacyFlag();
  if (!force && ((lf && lf.uid === user.id) || sessionStorage.getItem('gv.legacyLater'))) return;
  const nF = legacy.items.reduce((a, i) => a + i.atts.length, 0);
  const ch = force ? 'upload' : await choose('Gear found on this device', `<p class="hint">This browser has GearVault data that was stored only on this device: <b>${plural(legacy.items.length, 'item')}</b>, ${plural(legacy.kits.length, 'kit')}, ${plural(legacy.trips.length, 'trip')}, ${plural(nF, 'photo/receipt')}.</p><p class="hint">Upload it to your cloud account? The on-device copy is kept until you delete it in <b>Data</b>. Uploading twice won't create duplicates.</p>`,
    [['upload', '☁ Upload my on-device gear to the cloud', 'primary'], ['later', 'Not now']]);
  if (ch !== 'upload') { sessionStorage.setItem('gv.legacyLater', '1'); return; }
  const r = await bringIn(legacy, async id => (await Files.get(id).catch(() => null))?.blob || null, 'merge');
  if (r.ok) { localStorage.setItem(Store.LEGACY_UPLOADED_KEY, JSON.stringify({ uid: user.id, at: Date.now(), items: legacy.items.length, files: r.files })); toast(`Uploaded ${plural(legacy.items.length, 'item')} + ${plural(r.files, 'file')} to the cloud`, 3000); }
  else toast('Upload not finished — it will retry; you can also run it again from Data', 3500);
  render();
}
async function refreshFromCloud(force = false) {
  if (!cloud || isOffline() || syncing || unsaved() || (!force && (ui.edit || layers.length || $('#printRoot').classList.contains('show')))) return false;
  try {
    const n = await cloud.loadAll();
    const changed = M.diff(M.snapshotOf(M.rowsFromState(S, user.id)), M.rowsFromState(n, user.id)).count > 0;
    if (changed) { S = n; render(); }
    await saveCache(); renderBadge(); return changed;
  } catch (e) { console.warn('refresh failed', e); if (force) toast('Refresh failed: ' + (e.message || e)); return false; }
}
function clearLocalSession() { for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); localStorage.removeItem(LAST_UID); }
// Actions that change data — blocked while offline / read-only.
const MUTATING = new Set(['newItem', 'saveItem', 'dupItem', 'deleteItem', 'removeAtt', 'newKit', 'saveKit', 'deleteKit', 'newTrip', 'deleteTrip', 'toggleTripKit',
  'pickTripItems', 'saveTripItems', 'removeTripItem', 'excludeLine', 'restoreLine', 'addCategory', 'delCategory', 'eraseAll', 'uploadLegacy']);

const ACTIONS = {
  closeTop: () => closeLayer(),
  refreshNow: async () => { if (isOffline()) return toast('Offline'); const ch = await refreshFromCloud(true); toast(ch ? 'Updated from the cloud' : 'Already up to date'); },
  signOut: async () => {
    if (unsaved() && !(await confirmBox('Some changes are not saved to the cloud yet. Sign out anyway?', 'Sign out'))) return;
    try { if (sb) await sb.auth.signOut(); } catch { }
    clearLocalSession(); await Cache.clearAll().catch(() => {}); location.reload();
  },
  uploadLegacy: () => offerLegacyUpload(true),
  deleteLegacy: async () => {
    if (!(await confirmBox('Delete the on-device v1 copy?', 'Delete local copy', '<p class="hint">Only the old copy stored in this browser is removed. Your cloud data is not touched.</p>'))) return;
    localStorage.removeItem(Store.LEGACY_KEY); localStorage.removeItem(Store.LEGACY_UPLOADED_KEY); await Files.clear().catch(() => {}); render(); toast('On-device copy deleted');
  },
  newItem: el => { const it = Store.makeItem(S.settings); if (el?.dataset.cat) it.category = el.dataset.cat; openItemEditor(it, true); },
  editItem: el => { const it = S.items.find(i => i.id === el.dataset.id); if (it) openItemEditor(it); },
  cancelEdit: () => closeLayer(),
  saveItem: () => saveEdit(),
  dupItem: () => { const src = ui.edit.d; closeLayer(); const it = Store.sanitizeItem({ ...src, tags: Store.splitTags(src.tagsText), id: Store.uid('itm'), serial: '', atts: [], name: (src.name || '') + ' (copy)', created: Date.now() }, S.settings); openItemEditor(it, true); toast('Copy — enter its serial number'); },
  deleteItem: async () => {
    const d = ui.edit.d; if (!(await confirmBox(`Delete “${itemTitle(d)}”?`, 'Delete', '<p class="hint">Its photos and receipts are deleted too. It is removed from kits and trips.</p>'))) return;
    const unsavedAtts = d.atts.concat(ui.edit.removed || []).filter(a => ui.edit.newAtts.includes(a.id));
    cloud.removeFiles(unsavedAtts.flatMap(a => [a.path, a.thumb]).filter(Boolean)); // saved files go with the sync
    S.items = S.items.filter(i => i.id !== d.id);
    S.kits.forEach(k => { k.itemIds = k.itemIds.filter(x => x !== d.id); });
    S.trips.forEach(t => { t.itemIds = t.itemIds.filter(x => x !== d.id); t.excluded = t.excluded.filter(x => x !== d.id); });
    ui.edit = null; closeLayer(undefined, true); persist(); render(); toast('Deleted');
  },
  toggleEditKit: el => { const s = ui.edit.kits, id = el.dataset.id; s.has(id) ? s.delete(id) : s.add(id); el.classList.toggle('on', s.has(id)); },
  viewAtt: (el, e) => { if (e.target.closest('.x')) return; const a = ui.edit?.d.atts.find(x => x.id === el.dataset.id); if (a) viewAtt(a); },
  removeAtt: async el => { const E = ui.edit, a = E.d.atts.find(x => x.id === el.dataset.id); if (!a) return; if (!(await confirmBox(`Remove ${a.kind} “${a.name}”?`, 'Remove'))) return; E.d.atts = E.d.atts.filter(x => x !== a); E.pendingDel.push(a.id); (E.removed = E.removed || []).push(a); renderAtts(); },
  clearFilters: () => { Object.assign(ui, { q: '', fCat: '', fStatus: '', fTag: '' }); render(); },
  exportInvCSV: () => { download(`GearVault_inventory_${today()}.csv`, new Blob([C.inventoryCSV(S.items)], { type: 'text/csv;charset=utf-8' })); toast(`Exported ${plural(S.items.length, 'item')}`); },
  csvTemplate: () => download('GearVault_inventory_template.csv', new Blob([C.toCSV([C.INV_COLS.map(c => c[0])])], { type: 'text/csv;charset=utf-8' })),
  // kits
  newKit: () => openKitEditor(Store.makeKit(`Kit ${S.kits.length + 1}`), true),
  editKit: el => { const k = S.kits.find(x => x.id === el.dataset.id); if (k) openKitEditor(k, false); },
  saveKit: (el) => {
    const o = el.closest('.overlay'), k = o._kit, name = $('#kName', o).value.trim(); if (!name) return toast('Name the kit');
    Object.assign(k, { name, type: $('#kType', o).value, notes: $('#kNotes', o).value, itemIds: pickedIds(o), updated: Date.now() });
    if (o._isNew) S.kits.push(k); persist(); closeLayer(o, true); render(); toast(`Saved kit “${name}”`);
  },
  deleteKit: async el => {
    const o = el.closest('.overlay'), k = o._kit; if (!(await confirmBox(`Delete kit “${k.name}”?`, 'Delete', '<p class="hint">The gear itself is kept.</p>'))) return;
    S.kits = S.kits.filter(x => x.id !== k.id); S.trips.forEach(t => { t.kitIds = t.kitIds.filter(x => x !== k.id); }); persist(); closeLayer(o, true); render();
  },
  // trips
  newTrip: () => { const t = Store.makeTrip(S.settings, `Trip ${S.trips.length + 1}`); S.trips.push(t); ui.tripId = t.id; persist(); render(); const n = $('[data-tf=name]'); n?.focus(); n?.select(); },
  openTrip: el => { ui.tripId = el.dataset.id; render(); window.scrollTo(0, 0); },
  backTrips: () => { ui.tripId = null; render(); },
  deleteTrip: async () => { const t = trip(); if (!(await confirmBox(`Delete trip “${t.name}”?`, 'Delete', '<p class="hint">Gear and kits are kept.</p>'))) return; S.trips = S.trips.filter(x => x !== t); ui.tripId = null; persist(); render(); },
  toggleTripKit: el => { const t = trip(), id = el.dataset.id; t.kitIds = t.kitIds.includes(id) ? t.kitIds.filter(x => x !== id) : [...t.kitIds, id]; t.updated = Date.now(); el.classList.toggle('on', t.kitIds.includes(id)); persist(); refreshTripLines(); },
  pickTripItems: () => {
    const t = trip();
    const o = openLayer(`<div class="sheet-h"><div class="title">ADD ITEMS TO ${esc(t.name.toUpperCase())}</div><button class="iconbtn" data-act="closeTop" aria-label="Close">✕</button></div>
      <p class="hint">Items already in a selected kit are included automatically.</p>${pickerHTML(new Set(t.itemIds), 'trip')}
      <div class="sheet-f"><span class="grow"></span><button class="btn ghost" data-act="closeTop">Cancel</button><button class="btn primary" data-act="saveTripItems">Done</button></div>`, { cls: 'wide', backdrop: false });
    o._trip = t;
  },
  saveTripItems: el => { const o = el.closest('.overlay'), t = o._trip; t.itemIds = pickedIds(o); t.excluded = t.excluded.filter(id => !t.itemIds.includes(id)); persist(); closeLayer(o, true); render(); },
  removeTripItem: el => { const t = trip(); t.itemIds = t.itemIds.filter(x => x !== el.dataset.id); persist(); render(); },
  excludeLine: el => { const t = trip(), id = el.dataset.id; t.itemIds = t.itemIds.filter(x => x !== id); if (t.kitIds.some(k => S.kits.find(x => x.id === k)?.itemIds.includes(id)) && !t.excluded.includes(id)) t.excluded.push(id); persist(); render(); },
  restoreLine: el => { const t = trip(); t.excluded = t.excluded.filter(x => x !== el.dataset.id); persist(); render(); },
  previewCarnet: () => { if (!C.buildGeneralList(S, trip()).lines.length) return toast('Add kits or items first'); showPaper(); },
  closePaper: () => closePaper(),
  printCarnet: () => printCarnet(),
  csvCarnet: () => exportCarnetCSV(),
  // data
  exportBackup: () => exportBackup(),
  addCategory: () => { let n = 'New category', k = 2; while (S.settings.categories.includes(n)) n = `New category ${k++}`; S.settings.categories.push(n); persist(); render(); const ins = $$('[data-cat-ix]'); const last = ins[ins.length - 1]; last?.focus(); last?.select(); },
  delCategory: async el => {
    const ix = +el.dataset.ix, c = S.settings.categories[ix], n = S.items.filter(i => i.category === c).length;
    if (n && !(await confirmBox(`Delete category “${c}”?`, 'Delete', `<p class="hint">${plural(n, 'item')} will move to “Other”.</p>`))) return;
    S.settings.categories.splice(ix, 1); if (!S.settings.categories.includes('Other')) S.settings.categories.push('Other');
    S.items.forEach(i => { if (i.category === c) i.category = 'Other'; }); persist(); render();
  },
  persistStorage: async () => { const ok = navigator.storage?.persist ? await navigator.storage.persist() : false; toast(ok ? 'Storage marked persistent' : 'Browser declined — install to Home Screen and keep backups'); storageInfo(); },
  eraseAll: async () => {
    if (!(await confirmBox('Erase ALL GearVault data in the cloud?', 'Erase everything', '<p class="warn">Deletes every item, kit, trip, photo and receipt in your Supabase account — on every device. This cannot be undone. Export a backup first.</p>'))) return;
    const keep = S.settings; S = Store.emptyState(); S.settings = keep; ui.tripId = null; urlCache.clear(); await Cache.clearAll().catch(() => {});
    render(); clearTimeout(syncT); await runSync(); toast(syncErr ? 'Erase not finished — will retry' : 'All cloud data erased');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACTIONS[el.dataset.act]; if (!fn) return;
  e.preventDefault();
  if (MUTATING.has(el.dataset.act) && readOnly()) return toast(isOffline() ? 'Offline — read-only. Reconnect to make changes.' : 'Not connected to the cloud');
  fn(el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#printRoot').classList.contains('show')) return closePaper(); if (layers.length) closeLayer(); }
  if (e.key === 'Enter' && e.target.classList?.contains('att')) e.target.click();
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (!b) return; ui.view = b.dataset.view; if (ui.view !== 'trips') ui.tripId = null; render(); });

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'q') { ui.q = el.value; return renderGearList(); }
  if (el.dataset.f && ui.edit) { ui.edit.d[el.dataset.f] = el.value; const fl = el.closest('.fld'); if (fl && (el.dataset.f === 'serial' || el.dataset.f === 'origin')) fl.classList.toggle('need', !el.value.trim()); return; }
  if (el.hasAttribute('data-pickfilter')) { const q = el.value.toLowerCase().trim(); $$('.pick', el.closest('.modal-card')).forEach(p => { p.style.display = !q || p.dataset.s.includes(q) ? '' : 'none'; }); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.filter) { ui[el.dataset.filter] = el.value; return renderGearList(); }
  if (el.dataset.f && ui.edit) { ui.edit.d[el.dataset.f] = el.value; return; }
  if (el.closest('.pick')) { el.closest('.pick').classList.toggle('on', el.checked); return; }
  if (el.dataset.attkind && ui.edit) {
    const files = [...el.files]; el.value = ''; if (!files.length) return;
    toast(`Adding ${plural(files.length, 'file')}…`);
    const ids = await addFiles(files, el.dataset.attkind, ui.edit.d.atts, ui.edit.d.id); ui.edit.newAtts.push(...ids); renderAtts();
    if (ids.length) toast(`Attached ${plural(ids.length, el.dataset.attkind)}`); return;
  }
  if ((el.dataset.import || el.dataset.tf || el.dataset.set || el.dataset.catIx != null || el.dataset.attkind) && readOnly()) {
    if (el.type === 'file') el.value = ''; toast('Offline — read-only. Reconnect to make changes.'); if (!el.dataset.attkind) render(); return;
  }
  if (el.dataset.import) { const f = el.files[0]; el.value = ''; if (!f) return; return el.dataset.import === 'csv' ? importCSV(f) : importBackup(f); }
  if (el.dataset.tf) {
    const t = trip(); if (!t) return; const k = el.dataset.tf;
    t[k] = el.type === 'checkbox' ? el.checked : k === 'name' ? (el.value.trim() || t.name) : el.value; t.updated = Date.now(); persist();
    if (k === 'name') $('#tripTitle').textContent = t.name;
    return refreshTripLines();
  }
  if (el.dataset.set) { S.settings[el.dataset.set] = el.value; persist(); renderDash(); return; }
  if (el.dataset.catIx != null) {
    const ix = +el.dataset.catIx, old = S.settings.categories[ix], nv = el.value.trim();
    if (!nv || nv === old) { el.value = old; return; }
    if (S.settings.categories.includes(nv)) { toast('That category already exists'); el.value = old; return; }
    S.settings.categories[ix] = nv; S.items.forEach(i => { if (i.category === old) i.category = nv; }); persist(); toast(`Renamed to “${nv}”`); return;
  }
});
window.addEventListener('afterprint', () => { /* keep preview open so the user can print again or close */ });

// ---------- boot: config → (offline cache | sign-in → TOTP → aal2) → load → app ----------
function unlock() { document.body.classList.remove('locked'); $('#auth').hidden = true; render(); renderBadge(); }
function fatal(title, e, allowSignOut = true) {
  const root = $('#auth'); root.hidden = false; document.body.classList.add('locked');
  root.innerHTML = `<div class="auth-card pane"><div class="lbl auth-title">${esc(title)}</div><p class="warn">${esc(e?.message || e)}</p>
    <p class="hint">If this is a new Supabase project, make sure <b>supabase/migrations/0001_init.sql</b> ran in the SQL editor.</p>
    <div class="row wrap"><button class="btn primary" onclick="location.reload()">Retry</button>${allowSignOut ? '<button class="btn ghost" data-act="signOut">Sign out</button>' : ''}</div></div>`;
}
async function openFromCache() {
  const c = await Cache.kvGet('state').catch(() => null), uid = localStorage.getItem(LAST_UID);
  if (!c || !uid || c.uid !== uid) return false;
  S = Store.sanitizeState(c.S); user = { id: c.uid, email: c.email }; bootOffline = true; unlock();
  toast('Offline — showing your last synced copy (read-only)', 2800); return true;
}
async function boot() {
  const root = $('#auth');
  const factory = window.__GV_TEST_SUPABASE__; // test hook: tools/fake-supabase.js
  const configured = !!factory || (!/YOUR-PROJECT-REF/.test(CFG.SUPABASE_URL) && !/YOUR-ANON/.test(CFG.SUPABASE_ANON_KEY));
  if (!configured) return Auth.showSetup(root);
  if (!navigator.onLine) { if (!(await openFromCache())) Auth.showOfflineNoSession(root); return; }
  try {
    sb = factory ? factory(CFG) : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch (e) { return fatal('Could not start Supabase', e, false); }
  const res = await Auth.ensureAal2(sb, root, { allowSignup: !!CFG.ALLOW_SIGNUP, recovery: /type=recovery/.test(location.hash) });
  user = res.user; localStorage.setItem(LAST_UID, user.id);
  const cached = await Cache.kvGet('state').catch(() => null);
  if (cached && cached.uid !== user.id) await Cache.clearAll().catch(() => {}); // another account used this browser before
  cloud = createCloud(sb, user, CFG.STORAGE_BUCKET);
  try { S = await cloud.loadAll(); }
  catch (e) {
    console.warn('GearVault: cloud load failed', e);
    if (cached && cached.uid === user.id) { S = Store.sanitizeState(cached.S); bootOffline = true; unlock(); toast('Could not reach the cloud — showing your last synced copy (read-only)', 3500); return; }
    return fatal('Could not load your gear', e);
  }
  unlock(); await saveCache();
  if (cloud.pending(S)) runSync(); // first run writes default settings + categories
  offerLegacyUpload();
}
$('#netBadge').addEventListener('click', () => { if (bootOffline && navigator.onLine) location.reload(); else if (syncErr) runSync(); else ui.view = 'data', render(); });
window.addEventListener('online', () => { renderBadge(); if (bootOffline) { toast('Back online — tap the badge to reconnect', 3500); $('#netBadge').textContent = 'OFFLINE · TAP TO RECONNECT'; } else { runSync().then(() => refreshFromCloud()); } });
window.addEventListener('offline', () => { renderBadge(); toast('Offline — read-only until you reconnect'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFromCloud(); });
window.addEventListener('beforeunload', e => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW registration failed', e));
window.__gv = { get S() { return S; }, ui, render, Files, C, Store, M, Cache, layers, get cloud() { return cloud; }, get user() { return user; }, runSync, refreshFromCloud, readOnly };
boot();
