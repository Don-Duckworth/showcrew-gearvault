// Headless browser checks (needs playwright + chromium). Serve this folder, then: GV_URL=http://127.0.0.1:8766/ node tools/browser-test.mjs
// Sample items below exist ONLY inside this test run (clearly marked SAMPLE) — the app ships with no seed data.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.GV_URL || 'http://127.0.0.1:8766/';
const OUT = URL_('../screenshots/');
function URL_(p) { return new globalThis.URL(p, import.meta.url).pathname; }
const TMP = '/tmp/gv-test/'; fs.mkdirSync(TMP, { recursive: true });
const results = []; let fails = 0; const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();

// ---------- sample files (generated) ----------
const gen = await browser.newPage();
const pngData = async (label, w, h, kind) => Buffer.from(await gen.evaluate(([label, w, h, kind]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  if (kind === 'receipt') {
    x.fillStyle = '#fbfaf5'; x.fillRect(0, 0, w, h); x.fillStyle = '#222'; x.font = 'bold 34px monospace'; x.fillText('SAMPLE STORE', 40, 70);
    x.font = '22px monospace'; ['RECEIPT — TEST DATA', '', label, 'Qty 1', '', 'TOTAL  USD 3,499.00', '', 'Thank you'].forEach((t, i) => x.fillText(t, 40, 130 + i * 34));
  } else {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#30343c'); g.addColorStop(1, '#15171b'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#9aa3ad'; x.fillRect(w * .15, h * .2, w * .7, h * .45); x.fillStyle = '#0b1a2c'; x.fillRect(w * .18, h * .24, w * .64, h * .37);
    x.fillStyle = '#7f8891'; x.fillRect(w * .08, h * .66, w * .84, h * .07); x.fillStyle = '#00e5ff'; x.font = `bold ${Math.round(h / 12)}px sans-serif`; x.fillText(label, w * .22, h * .45);
  }
  return [...atob(c.toDataURL('image/png').split(',')[1])].map(ch => ch.charCodeAt(0));
}, [label, w, h, kind]));
const photoA = await pngData('SAMPLE', 1200, 800, 'photo');
const photoB = await pngData('RACK', 1200, 800, 'photo');
const receiptPng = await pngData('MacBook Pro 16 (sample)', 600, 900, 'receipt');
const pdf = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 18 Tf 30 120 Td (SAMPLE RECEIPT - TEST) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);
await gen.close();

async function newCtx(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, ...opts });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL); await page.waitForSelector('#view'); await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const tap = async (page, sel, touch) => (touch ? page.locator(sel).first().tap() : page.locator(sel).first().click());
async function fillItem(page, f) {
  for (const [k, v] of Object.entries(f)) {
    const el = page.locator(`.overlay [data-f="${k}"]`);
    if ((await el.evaluate(e => e.tagName)) === 'SELECT') await el.selectOption(v); else await el.fill(String(v));
  }
}
async function addItem(page, f, files = [], touch = false) {
  await tap(page, '#addBtn', touch); await page.waitForSelector('.overlay [data-f=name]');
  await fillItem(page, f);
  for (const [kind, name, mime, buf] of files) {
    await page.setInputFiles(`.overlay input[data-attkind=${kind}]`, { name, mimeType: mime, buffer: buf });
    await page.waitForFunction(n => window.__gv.ui.edit?.d.atts.some(a => a.name === n), name);
  }
  await tap(page, '.overlay [data-act=saveItem]', touch); await page.waitForFunction(() => !document.querySelector('.overlay'));
}
const dl = async (page, trigger) => { const [d] = await Promise.all([page.waitForEvent('download'), trigger()]); const p = TMP + d.suggestedFilename(); await d.saveAs(p); return p; };
const hideToast = async page => { await page.evaluate(() => document.getElementById('toast').classList.remove('show')); await page.waitForTimeout(250); };
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ======================= DESKTOP =======================
let { ctx, page, errs } = await newCtx({ width: 1440, height: 900 });
ok(await page.locator('.empty h3').isVisible(), 'desktop: empty state shown on first run (no seed data)');
ok((await page.evaluate(() => __gv.S.items.length)) === 0, 'no seed items');
ok((await page.locator('.empty .chip').count()) === 11, 'empty state lists 11 example categories');
await hideToast(page); await page.screenshot({ path: OUT + 'desktop-empty.png' });

await addItem(page, { name: 'SAMPLE Show laptop A', category: 'Laptop – Mac', make: 'Apple', model: 'MacBook Pro 16" M3 Max', serial: 'SAMPLE-C02XK1', purchaseDate: '2024-02-12', price: '3499', vendor: 'Apple Store (sample)', origin: 'China', weight: '2.14', tagsText: 'millumin, playback' },
  [['photo', 'laptop.png', 'image/png', photoA], ['receipt', 'receipt.pdf', 'application/pdf', pdf], ['receipt', 'receipt-photo.png', 'image/png', receiptPng]]);
let it = await page.evaluate(() => __gv.S.items[0]);
ok(it && it.name === 'SAMPLE Show laptop A' && it.price === 3499 && it.origin === 'China' && it.tags.join() === 'millumin,playback', 'add item via form saves fields');
ok(it.atts.length === 3 && it.atts.filter(a => a.kind === 'receipt').length === 2, 'photo + 2 receipts attached');
const keys = await page.evaluate(() => __gv.Files.keys());
ok(keys.length === 3 && it.atts.every(a => keys.includes(a.id)), 'attachments stored in IndexedDB (' + keys.length + ' blobs)');
ok(await page.evaluate(() => localStorage.getItem('showcrew.gearvault.v1').length < 5000), 'localStorage holds metadata only (no blobs)');
await page.waitForFunction(() => document.querySelector('.gear .thumb img')?.naturalWidth > 0);
ok(true, 'list thumbnail rendered from IndexedDB');

await addItem(page, { name: 'SAMPLE Playback PC', category: 'Rack-mount PC', make: 'SampleCorp', model: '2U Media Server', serial: 'SAMPLE-RK2U-0042', purchaseDate: '2023-09-01', price: '6200', currentValue: '4800', vendor: 'Integrator (sample)', origin: 'Taiwan', weight: '18', weightUnit: 'kg', tagsText: 'millumin' }, [['photo', 'rack.png', 'image/png', photoB]]);
await addItem(page, { name: 'SAMPLE Audio interface', category: 'Audio / sound device', make: 'Focusrite', model: 'Scarlett 4i4', serial: 'SAMPLE-S4I4-777', price: '249.99', origin: 'China', weight: '0.6' });
await addItem(page, { name: 'SAMPLE Starlink Mini', category: 'Network (e.g. Starlink Mini)', make: 'Starlink', model: 'Mini', serial: 'SAMPLE-SLM-001', price: '499', weight: '1.1' }); // no origin → flag
await addItem(page, { name: 'SAMPLE HDMI cables 3 m', category: 'Cable / accessory', make: 'Generic', qty: '6', price: '15', origin: 'China', weight: '0.2' }); // no serial → flag
ok((await page.locator('.gear').count()) === 5, 'list shows 5 items');
const snap = await page.evaluate(() => __gv.S.items.map(i => [i.name, i.serial, i.price].join('|')).join(' / '));
ok(snap === 'SAMPLE Show laptop A|SAMPLE-C02XK1|3499 / SAMPLE Playback PC|SAMPLE-RK2U-0042|6200 / SAMPLE Audio interface|SAMPLE-S4I4-777|249.99 / SAMPLE Starlink Mini|SAMPLE-SLM-001|499 / SAMPLE HDMI cables 3 m||15', 'every field landed in the right place: ' + snap);
const dash = await page.locator('#dash').innerText();
ok(dash.includes('$9,138') && dash.includes('3/5') && dash.includes('10 pieces'), 'dashboard totals ($9,138 = 3499+4800 current+249.99+499+6×15) + carnet-ready 3/5: ' + dash.replace(/\s+/g, ' '));

// edit item
await page.locator('.gear', { hasText: 'SAMPLE Show laptop A' }).click();
await page.waitForSelector('.overlay [data-f=currentValue]');
ok((await page.locator('.overlay .att').count()) === 3, 'editor shows 3 attachment tiles');
await page.locator('.overlay .att', { hasText: 'receipt-photo.png' }).click();
await page.waitForSelector('.viewer img'); await page.waitForFunction(() => document.querySelector('.viewer img').naturalWidth > 0);
ok(true, 'receipt image opens in viewer');
await page.locator('.overlay:last-child [data-act=closeTop]').click();
await page.locator('.overlay .att', { hasText: 'receipt.pdf' }).click();
ok(!!(await page.waitForSelector('.viewer iframe', { timeout: 5000 }).catch(() => null)), 'PDF receipt opens in viewer');
await page.locator('.overlay:last-child [data-act=closeTop]').click();
await page.fill('.overlay [data-f=currentValue]', '2600');
await page.fill('.overlay [data-f=notes]', '64 GB RAM, Millumin 4 + PowerPoint + Keynote');
await hideToast(page); await page.screenshot({ path: OUT + 'desktop-item-editor.png' });
await page.click('.overlay [data-act=saveItem]');
it = await page.evaluate(() => __gv.S.items.find(i => i.name === 'SAMPLE Show laptop A'));
ok(it.currentValue === 2600 && it.notes.includes('Millumin') && it.atts.length === 3, 'edit item: current value + notes saved, attachments kept');

// search / filter / sort
await page.fill('#q', 'RK2U'); ok((await page.locator('.gear').count()) === 1, 'search by serial finds 1');
await page.fill('#q', ''); await page.selectOption('[data-filter=fTag]', 'millumin'); ok((await page.locator('.gear').count()) === 2, 'tag filter #millumin → 2');
await page.selectOption('[data-filter=fTag]', ''); await page.selectOption('[data-filter=fCat]', 'Cable / accessory'); ok((await page.locator('.gear').count()) === 1, 'category filter → 1');
await page.selectOption('[data-filter=fCat]', ''); await page.selectOption('[data-filter=sort]', 'value');
ok((await page.locator('.gear .g-name').first().innerText()) === 'SAMPLE Playback PC', 'sort by value puts Playback PC first');
await page.selectOption('[data-filter=sort]', 'name');
await hideToast(page); await page.screenshot({ path: OUT + 'desktop-gear-list.png' });

// kits
await page.click('#nav [data-view=kits]'); await page.click('[data-act=newKit]');
await page.fill('#kName', 'Rack A');
await page.fill('.overlay [data-pickfilter]', 'SAMPLE-RK2U');
ok((await page.locator('.overlay .pick:visible').count()) === 1, 'kit picker filter');
await page.locator('.overlay .pick', { hasText: 'Playback PC' }).click();
await page.fill('.overlay [data-pickfilter]', '');
await page.locator('.overlay .pick', { hasText: 'Audio interface' }).click();
await page.locator('.overlay .pick', { hasText: 'HDMI cables' }).click();
await page.click('.overlay [data-act=saveKit]');
await page.click('[data-act=newKit]'); await page.fill('#kName', 'Laptop bag'); await page.selectOption('#kType', 'Bag');
await page.locator('.overlay .pick', { hasText: 'Show laptop A' }).click();
await page.click('.overlay [data-act=saveKit]');
const kits = await page.evaluate(() => __gv.S.kits.map(k => [k.name, k.itemIds.length]));
ok(JSON.stringify(kits) === '[["Rack A",3],["Laptop bag",1]]', 'kits created ' + JSON.stringify(kits));
ok((await page.locator('.kcard', { hasText: 'Rack A' }).innerText()).includes('missing carnet data'), 'kit card flags missing data');
await hideToast(page); await page.screenshot({ path: OUT + 'desktop-kits.png' });

// trip
await page.click('#nav [data-view=trips]'); await page.click('[data-act=newTrip]');
await page.fill('[data-tf=name]', 'SAMPLE Corporate GS — London'); await page.press('[data-tf=name]', 'Tab');
await page.fill('[data-tf=destinations]', 'United Kingdom, France'); await page.press('[data-tf=destinations]', 'Tab');
await page.fill('[data-tf=depart]', '2026-11-02'); await page.fill('[data-tf=ret]', '2026-11-09'); await page.press('[data-tf=ret]', 'Tab');
await page.fill('[data-tf=holder]', 'Don Duckworth'); await page.press('[data-tf=holder]', 'Tab');
await page.locator('[data-act=toggleTripKit]', { hasText: 'Rack A' }).click();
await page.locator('[data-act=toggleTripKit]', { hasText: 'Laptop bag' }).click();
await page.click('[data-act=pickTripItems]'); await page.locator('.overlay .pick', { hasText: 'Starlink' }).click(); await page.locator('.overlay .pick', { hasText: 'Show laptop A' }).click();
await page.click('.overlay [data-act=saveTripItems]');
let rows = await page.locator('#tripLines tbody tr').count();
ok(rows === 5, 'trip general list has 5 lines (kits + extra items, deduped): ' + rows);
let issues = await page.locator('#carnetIssues').innerText();
ok(issues.includes('1 missing serial') && issues.includes('1 missing country of origin'), 'pre-export flags: ' + issues);
let gl = await page.evaluate(() => { const t = __gv.S.trips[0]; return __gv.C.buildGeneralList(__gv.S, t); });
ok(gl.totals.pieces === 10 && gl.totals.value === 2600 + 4800 + 249.99 + 499 + 90, 'trip totals pieces 10, value uses current value override: ' + gl.totals.value);
ok(gl.lines[0].description === 'SampleCorp 2U Media Server – SAMPLE Playback PC', 'trade description = make + model + description');
// CSV with warning dialog
await page.click('#view [data-act=csvCarnet]');
ok(await page.locator('.overlay', { hasText: 'incomplete' }).isVisible(), 'export warns about incomplete lines');
let csvPath = await dl(page, () => page.click('.overlay [data-r="1"]'));
let csv = fs.readFileSync(csvPath, 'utf8');
ok(csv.startsWith('\uFEFF') && csv.includes('Item No.,"Trade description of goods') && csv.includes('SAMPLE-RK2U-0042') && /TOTAL,,10,/.test(csv), 'carnet CSV exported with header, serials, totals');
await hideToast(page); await page.screenshot({ path: OUT + 'desktop-trip-flags.png', fullPage: true });
// fix via Fix button
await page.locator('#tripLines tr', { hasText: 'Starlink' }).locator('[data-act=editItem]').click();
await page.fill('.overlay [data-f=origin]', 'Taiwan'); await page.click('.overlay [data-act=saveItem]');
await page.locator('#tripLines tr', { hasText: 'HDMI' }).locator('[data-act=editItem]').click();
await page.fill('.overlay [data-f=serial]', 'N/A-BULK-SAMPLE'); await page.click('.overlay [data-act=saveItem]');
issues = await page.locator('#carnetIssues').innerText();
ok(issues.includes('Every line'), 'after fixes, all lines complete');
// exclude + restore
await page.locator('#tripLines tr', { hasText: 'Audio interface' }).locator('[data-act=excludeLine]').click();
ok((await page.locator('#tripLines tbody tr').count()) === 4, 'exclude a kit item from this trip');
await page.click('[data-act=restoreLine]'); ok((await page.locator('#tripLines tbody tr').count()) === 5, 'restore excluded item');
await hideToast(page); await page.screenshot({ path: OUT + 'desktop-trip.png', fullPage: true });
// preview + print
await page.click('#view [data-act=previewCarnet]');
await page.waitForSelector('#printRoot.show .paper');
const paperRows = await page.locator('.paper tbody tr').count();
ok(paperRows === 5 && (await page.locator('.paper tfoot').innerText()).includes('GRAND TOTAL'), 'general list preview with 5 lines + grand total');
await hideToast(page); await page.screenshot({ path: OUT + 'carnet-preview.png' });
csvPath = await dl(page, () => page.click('.paperbar [data-act=csvCarnet]'));
ok(!fs.readFileSync(csvPath, 'utf8').includes('incomplete'), 'clean CSV export (no warning) from preview');
await page.emulateMedia({ media: 'print' });
await page.setViewportSize({ width: 1100, height: 850 });
ok(await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).display === 'none' && getComputedStyle(document.querySelector('.paperbar')).display === 'none'), 'print CSS hides app chrome');
await hideToast(page); await page.screenshot({ path: OUT + 'carnet-print.png', fullPage: true });
await page.pdf({ path: OUT + 'carnet-general-list-sample.pdf', format: 'Letter', landscape: true, printBackground: true });
await page.emulateMedia({ media: 'screen' }); await page.setViewportSize({ width: 1440, height: 900 });
await page.click('.paperbar [data-act=closePaper]');

// data: backup export, erase, restore
await page.click('#nav [data-view=data]');
const bkPath = await dl(page, () => page.click('[data-act=exportBackup]'));
const bk = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
ok(bk.app === 'ShowCrew GearVault' && bk.data.items.length === 5 && Object.keys(bk.files).length === 4 && Object.values(bk.files).every(f => f.data.startsWith('data:')), 'backup JSON has 5 items + 4 files as base64');
const invPath = await dl(page, () => page.click('#view [data-act=exportInvCSV]'));
const inv = fs.readFileSync(invPath, 'utf8');
ok(inv.split('\r\n').filter(Boolean).length === 6 && inv.includes('country_of_origin'), 'inventory CSV export (header + 5 rows)');
await page.click('[data-act=eraseAll]'); await page.click('.overlay [data-r="1"]');
await page.waitForFunction(() => __gv.S.items.length === 0);
ok((await page.evaluate(() => __gv.Files.keys())).length === 0, 'erase all clears IndexedDB');
await page.setInputFiles('#view input[data-import=backup]', bkPath);
await page.click('.overlay [data-r=replace]');
await page.waitForFunction(() => __gv.S.items.length === 5 && __gv.S.trips.length === 1);
ok(await page.waitForFunction(() => __gv.Files.keys().then(k => k.length === 4), null, { timeout: 8000 }).then(() => true, () => false), 'restore backup brings back 4 files');
await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Restored'));
ok((await page.evaluate(() => __gv.S.kits.length)) === 2, 'restore brings back kits');
// CSV import (update + add via aliases)
fs.writeFileSync(TMP + 'import.csv', 'Description,Brand,Model,Serial Number,Price,Country of Origin,Category,Tags\nSAMPLE Dock,CalDigit,TS4,SAMPLE-TS4-9,399.99,China,Docking station / hub,dock; spare\n');
await page.setInputFiles('#view input[data-import=csv]', TMP + 'import.csv');
await page.waitForFunction(() => __gv.S.items.length === 6 && document.getElementById('toast').textContent.startsWith('CSV'));
it = await page.evaluate(() => __gv.S.items.find(i => i.model === 'TS4'));
ok(it && it.make === 'CalDigit' && it.price === 399.99 && it.tags.join() === 'dock,spare', 'CSV import with header aliases');
const firstId = await page.evaluate(() => __gv.S.items[0].id);
fs.writeFileSync(TMP + 'update.csv', `id,current_value\n${firstId},2400\n`);
await page.setInputFiles('#view input[data-import=csv]', TMP + 'update.csv');
await page.waitForFunction(id => __gv.S.items.find(i => i.id === id).currentValue === 2400, firstId);
ok(await page.evaluate(id => __gv.S.items.find(i => i.id === id).atts.length === 3, firstId), 'CSV update by id keeps other fields & attachments');
// offline: service worker caches shell
await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.gear');
ok((await page.locator('.gear').count()) === 6, 'reload while OFFLINE works (service worker) and data persists');
await ctx.setOffline(false);
await page.click('#nav [data-view=data]'); await hideToast(page); await page.screenshot({ path: OUT + 'desktop-data.png' });
ok(errs.length === 0, 'no console errors (desktop) ' + JSON.stringify(errs));
await ctx.close();

// ======================= iPad =======================
const tapTargets = page => page.evaluate(() => [...document.querySelectorAll('.btn, .seg button, .chip:not(.static), .iconbtn, select.inp, input.inp')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0).filter(e => e.getBoundingClientRect().height < 36).map(e => e.className + ':' + e.textContent.trim().slice(0, 20)));
for (const [label, vp] of [['ipad-landscape', { width: 1180, height: 820 }], ['ipad-portrait', { width: 820, height: 1180 }]]) {
  ({ ctx, page, errs } = await newCtx(vp, { hasTouch: true, isMobile: false }));
  await page.click('#nav [data-view=data]');
  await page.setInputFiles('#view input[data-import=backup]', bkPath); await page.tap('.overlay [data-r=replace]');
  await page.waitForFunction(() => __gv.S.items.length === 5);
  await page.tap('#nav [data-view=gear]'); await page.waitForFunction(() => [...document.querySelectorAll('.gear .thumb img')].every(i => i.naturalWidth > 0));
  ok(await noOverflow(page), `${label}: no horizontal overflow (gear)`);
  const small = await tapTargets(page); ok(small.length === 0, `${label}: tap targets ≥ 36px ` + JSON.stringify(small));
  await hideToast(page); await page.screenshot({ path: OUT + `${label}-gear.png` });
  if (label === 'ipad-landscape') {
    await addItem(page, { name: 'SAMPLE USB-C hub', category: 'Docking station / hub', make: 'Anker', model: '7-in-1', serial: 'SAMPLE-ANK-55', price: '59.99', origin: 'China' }, [['receipt', 'hub-receipt.png', 'image/png', receiptPng]], true);
    ok(await page.evaluate(() => __gv.S.items.some(i => i.serial === 'SAMPLE-ANK-55' && i.atts.length === 1)), 'iPad: add item with receipt by touch');
    await page.locator('.gear', { hasText: 'Show laptop A' }).tap(); await page.waitForSelector('.overlay .att img');
    await page.waitForFunction(() => [...document.querySelectorAll('.overlay .att img')].every(i => i.naturalWidth > 0));
    await page.locator('.overlay .modal-card').evaluate(e => e.scrollTo(0, 820));
    await hideToast(page); await page.screenshot({ path: OUT + 'ipad-item-attachments.png' });
    await page.tap('.overlay [data-act=cancelEdit]');
  }
  await page.tap('#nav [data-view=trips]'); await page.locator('.kcard').first().tap(); await page.waitForSelector('#tripLines tbody tr');
  ok(await noOverflow(page), `${label}: no horizontal overflow (trip)`);
  await hideToast(page); await page.screenshot({ path: OUT + `${label}-trip.png`, fullPage: label === 'ipad-portrait' });
  ok(errs.length === 0, `no console errors (${label}) ` + JSON.stringify(errs));
  await ctx.close();
}

// ======================= iPhone =======================
({ ctx, page, errs } = await newCtx({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }));
await hideToast(page); await page.screenshot({ path: OUT + 'iphone-empty.png' });
await addItem(page, { name: 'SAMPLE MacBook Air backup', category: 'Laptop – Mac', make: 'Apple', model: 'MacBook Air 13"', serial: 'SAMPLE-AIR-13', price: '1299', origin: 'China', weight: '2.7', weightUnit: 'lb' }, [['photo', 'air.png', 'image/png', photoA]], true);
ok(await page.evaluate(() => __gv.S.items.length === 1 && __gv.S.items[0].atts.length === 1), 'iPhone: add item + photo by touch');
await page.tap('#nav [data-view=data]');
await page.setInputFiles('#view input[data-import=backup]', bkPath); await page.tap('.overlay [data-r=merge]');
await page.waitForFunction(() => __gv.S.items.length === 6);
ok(true, 'iPhone: merge-restore backup keeps existing item (6 items)');
await page.tap('#nav [data-view=gear]'); await page.waitForFunction(() => [...document.querySelectorAll('.gear .thumb img')].every(i => i.naturalWidth > 0));
ok(await noOverflow(page), 'iPhone: no horizontal overflow (gear)');
const smallP = await tapTargets(page); ok(smallP.length === 0, 'iPhone: tap targets ≥ 36px ' + JSON.stringify(smallP));
await hideToast(page); await page.screenshot({ path: OUT + 'iphone-gear.png' });
await page.locator('.gear', { hasText: 'Show laptop A' }).tap(); await page.waitForSelector('.overlay [data-f=name]');
ok(await page.evaluate(() => { const r = document.querySelector('.overlay .modal-card').getBoundingClientRect(); return r.left === 0 && Math.round(r.width) === 390; }), 'iPhone: editor is a full-screen sheet');
await hideToast(page); await page.screenshot({ path: OUT + 'iphone-item-editor.png' });
await page.tap('.overlay [data-act=cancelEdit]');
await page.tap('#nav [data-view=trips]'); await page.locator('.kcard').first().tap(); await page.waitForSelector('#tripLines tbody tr');
ok(await noOverflow(page), 'iPhone: no horizontal overflow (trip page; table scrolls inside its box)');
await hideToast(page); await page.screenshot({ path: OUT + 'iphone-trip.png', fullPage: true });
await page.tap('#view [data-act=previewCarnet]'); await page.waitForSelector('#printRoot.show');
await hideToast(page); await page.screenshot({ path: OUT + 'iphone-carnet-preview.png' });
ok(errs.length === 0, 'no console errors (iPhone) ' + JSON.stringify(errs));
await ctx.close();
await browser.close();
console.log(results.join('\n'));
console.log(fails ? `\n${fails} FAILED of ${results.length}` : `\nALL ${results.length} PASS`);
process.exit(fails ? 1 : 0);
