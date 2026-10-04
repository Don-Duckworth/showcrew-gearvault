// Headless browser checks for GearVault v2 (cloud). The Supabase client is replaced by tools/fake-supabase.js through the app's
// test hook (window.__GV_TEST_SUPABASE__), so login, TOTP enrollment/challenge, CRUD, uploads and the carnet run without a real project.
// Serve this folder, then: GV_URL=http://127.0.0.1:8766/ node tools/browser-test.mjs   (needs playwright + chromium)
// Sample items exist ONLY inside this test run (clearly marked SAMPLE) — the app ships with no seed data.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.GV_URL || 'http://127.0.0.1:8766/';
const OUT = new globalThis.URL('../screenshots/', import.meta.url).pathname;
const FAKE = new globalThis.URL('./fake-supabase.js', import.meta.url).pathname;
const TMP = '/tmp/gv-test/'; fs.mkdirSync(TMP, { recursive: true });
const results = []; let fails = 0; const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const EMAIL = 'don@example.com', PW = 'correct horse battery', CODE = '246810';
const DON = '0d0d0d0d-1111-4222-8333-444455556666';

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

async function newCtx(viewport, { fake = true, opts = {}, ctxOpts = {}, url = URL } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, ...ctxOpts });
  if (fake) { await ctx.addInitScript(o => { window.__FAKE_SB_OPTS = o; }, opts); await ctx.addInitScript({ path: FAKE }); }
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(url); await page.waitForTimeout(250);
  return { ctx, page, errs };
}
const tap = async (page, sel, touch) => (touch ? page.locator(sel).first().tap() : page.locator(sel).first().click());
const submit = (page, touch) => tap(page, '#auth button[type=submit]', touch);
const authTitle = page => page.locator('#auth .auth-title').innerText();
async function signIn(page, { email = EMAIL, pw = PW, touch = false } = {}) {
  await page.waitForSelector('#auth #email'); await page.fill('#email', email); await page.fill('#pw', pw); await submit(page, touch);
}
async function code(page, c = CODE, touch = false) { await page.waitForSelector('#auth #code'); await page.fill('#code', c); await submit(page, touch); }
const unlocked = page => page.waitForFunction(() => !document.body.classList.contains('locked') && window.__gv?.cloud?.ready !== false, null, { timeout: 10000 });
const settled = page => page.waitForFunction(() => /SYNCED/.test(document.getElementById('netBadge').textContent), null, { timeout: 10000 });
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
  await settled(page);
}
const dl = async (page, trigger) => { const [d] = await Promise.all([page.waitForEvent('download'), trigger()]); const p = TMP + d.suggestedFilename(); await d.saveAs(p); return p; };
const hideToast = async page => { await page.evaluate(() => document.getElementById('toast').classList.remove('show')); await page.waitForTimeout(250); };
const shot = async (page, name, o = {}) => { await hideToast(page); await page.screenshot({ path: OUT + name, ...o }); };
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const fdb = page => page.evaluate(() => { __fakeSb.reload(); return __fakeSb.db.tables; });

// ======================= 0. not configured =======================
let { ctx, page, errs } = await newCtx({ width: 1280, height: 860 }, { fake: false });
ok((await authTitle(page)) === 'CLOUD NOT CONFIGURED', 'without config.js values (and no test client) the app shows the setup screen');
ok(await page.locator('.topbar').isHidden(), 'no app chrome / data while not configured');
await ctx.close();

// ======================= 1. DESKTOP: sign in → mandatory TOTP enrollment =======================
({ ctx, page, errs } = await newCtx({ width: 1440, height: 900 }));
ok((await authTitle(page)) === 'SIGN IN', 'sign-in screen first');
ok(await page.locator('[data-go=signup]').count() === 0, 'no "Create account" link when ALLOW_SIGNUP = false');
ok(await page.locator('.topbar').isHidden() && await page.locator('#view').isHidden(), 'app hidden before sign-in');
await shot(page, 'desktop-signin.png');
await signIn(page, { pw: 'wrong password' });
await page.waitForSelector('#auth .auth-err:not([hidden])');
ok((await page.locator('#auth .auth-err').innerText()).includes('Invalid login'), 'wrong password rejected');
await page.fill('#pw', PW); await submit(page);
await page.waitForSelector('#auth #qr');
ok((await authTitle(page)).includes('TWO-FACTOR (REQUIRED)'), 'first sign-in forces TOTP enrollment');
ok((await page.locator('#secret').inputValue()).length > 10 && (await page.locator('#qr').getAttribute('src')).startsWith('data:image/svg'), 'QR code + secret shown from mfa.enroll');
ok(await page.locator('.topbar').isHidden(), 'still no data at aal1 (enrollment pending)');
await shot(page, 'desktop-mfa-enroll.png');
await code(page, '000000');
await page.waitForSelector('#auth .auth-err:not([hidden])');
ok((await page.locator('#auth .auth-err').innerText()).includes('Invalid TOTP'), 'wrong TOTP code rejected');
let log = await page.evaluate(() => __fakeSb.log.filter(l => ['select', 'upsert', 'delete', 'upload', 'download'].includes(l.op)));
ok(log.length === 0, 'no database/storage calls at all before aal2');
await code(page);
await unlocked(page); await settled(page);
ok(await page.locator('.empty h3').isVisible(), 'after TOTP: app unlocked, empty vault (no seed data)');
log = await page.evaluate(() => __fakeSb.log.filter(l => ['select', 'upsert', 'delete', 'upload', 'download'].includes(l.op)));
ok(log.length > 0 && log.every(l => l.aal === 'aal2'), 'every data call made at aal2 (' + log.length + ' calls)');
let T = await fdb(page);
ok(T.settings.length === 1 && T.categories.length === 11, 'first run writes settings + 11 default categories to the cloud');
ok((await page.locator('#netBadge').innerText()).includes('SYNCED'), 'cloud badge shows SYNCED');

// ----- CRUD + uploads -----
await addItem(page, { name: 'SAMPLE Show laptop A', category: 'Laptop – Mac', make: 'Apple', model: 'MacBook Pro 16" M3 Max', serial: 'SAMPLE-C02XK1', purchaseDate: '2024-02-12', price: '3499', vendor: 'Apple Store (sample)', origin: 'China', weight: '2.14', tagsText: 'millumin, playback' },
  [['photo', 'laptop.png', 'image/png', photoA], ['receipt', 'receipt.pdf', 'application/pdf', pdf], ['receipt', 'receipt-photo.png', 'image/png', receiptPng]]);
T = await fdb(page);
let it = T.items[0];
ok(T.items.length === 1 && it.name === 'SAMPLE Show laptop A' && +it.price === 3499 && it.origin === 'China' && it.tags.join() === 'millumin,playback' && it.owner_id === DON, 'item row saved in cloud with owner_id');
ok(/^[0-9a-f-]{36}$/.test(it.id), 'item id is a UUID');
ok(T.attachments.length === 3 && T.attachments.every(a => a.path.startsWith(`${DON}/${it.id}/`)), 'attachment rows point into <uid>/<item>/ folder');
let objs = await page.evaluate(() => __fakeSb.objects());
ok(objs.length === 5 && objs.filter(o => o.endsWith('.thumb.jpg')).length === 2, 'files uploaded to private bucket (3 files + 2 image thumbnails)');
await page.waitForFunction(() => document.querySelector('.gear .thumb img')?.naturalWidth > 0);
ok(true, 'list thumbnail loaded from storage');
await addItem(page, { name: 'SAMPLE Playback PC', category: 'Rack-mount PC', make: 'SampleCorp', model: '2U Media Server', serial: 'SAMPLE-RK2U-0042', purchaseDate: '2023-09-01', price: '6200', currentValue: '4800', vendor: 'Integrator (sample)', origin: 'Taiwan', weight: '18', tagsText: 'millumin' }, [['photo', 'rack.png', 'image/png', photoB]]);
await addItem(page, { name: 'SAMPLE Audio interface', category: 'Audio / sound device', make: 'Focusrite', model: 'Scarlett 4i4', serial: 'SAMPLE-S4I4-777', price: '249.99', origin: 'China', weight: '0.6' });
await addItem(page, { name: 'SAMPLE Starlink Mini', category: 'Network (e.g. Starlink Mini)', make: 'Starlink', model: 'Mini', serial: 'SAMPLE-SLM-001', price: '499', weight: '1.1' });
await addItem(page, { name: 'SAMPLE HDMI cables 3 m', category: 'Cable / accessory', make: 'Generic', qty: '6', price: '15', origin: 'China', weight: '0.2' });
await addItem(page, { name: 'SAMPLE Throwaway', category: 'Other', serial: 'X' }, [['photo', 'tmp.png', 'image/png', photoB]]);
ok((await page.locator('.gear').count()) === 6, 'list shows 6 items');
// view receipt via signed URL
await page.locator('.gear', { hasText: 'SAMPLE Show laptop A' }).click();
await page.locator('.overlay .att', { hasText: 'receipt-photo.png' }).click();
await page.waitForSelector('.viewer img'); await page.waitForFunction(() => document.querySelector('.viewer img').naturalWidth > 0);
log = await page.evaluate(() => __fakeSb.log.filter(l => l.op === 'sign'));
ok(log.length >= 1 && log[0].exp <= 3600, 'receipt opened through a short-lived signed URL (' + log[0]?.exp + 's)');
await page.locator('.overlay:last-child [data-act=closeTop]').click();
// edit
await page.fill('.overlay [data-f=currentValue]', '2600');
await page.fill('.overlay [data-f=notes]', '64 GB RAM, Millumin 4 + PowerPoint + Keynote');
// remove the PDF in this edit (saved file → removed by the sync)
await page.locator('.overlay .att', { hasText: 'receipt.pdf' }).locator('.x').click(); await page.click('.overlay:last-child [data-r="1"]');
await shot(page, 'desktop-item-editor.png');
await page.click('.overlay [data-act=saveItem]'); await settled(page);
T = await fdb(page); it = T.items.find(i => i.name === 'SAMPLE Show laptop A');
ok(+it.current_value === 2600 && it.notes.includes('Millumin'), 'edit saved to cloud (current value + notes)');
objs = await page.evaluate(() => __fakeSb.objects());
ok(T.attachments.filter(a => a.item_id === it.id).length === 2 && !objs.some(o => o.endsWith(T.attachments[1]?.id) && false) && objs.length === 8, 'removed receipt: row + storage object deleted (' + objs.length + ' objects left)');
// cancel an edit with a fresh upload → orphan cleaned
await page.locator('.gear', { hasText: 'Audio interface' }).click();
await page.setInputFiles('.overlay input[data-attkind=photo]', { name: 'oops.png', mimeType: 'image/png', buffer: photoA });
await page.waitForFunction(() => window.__gv.ui.edit?.d.atts.length === 1);
await page.click('.overlay [data-act=cancelEdit]'); await page.waitForTimeout(200);
ok((await page.evaluate(() => __fakeSb.objects())).length === 8, 'cancelled edit: just-uploaded file removed from storage');
// delete item → cascade + storage cleanup
await page.locator('.gear', { hasText: 'SAMPLE Throwaway' }).click(); await page.click('.overlay [data-act=deleteItem]'); await page.click('.overlay:last-child [data-r="1"]'); await settled(page);
T = await fdb(page);
ok(T.items.length === 5 && (await page.evaluate(() => __fakeSb.objects())).length === 6, 'deleting an item removes its row, attachment rows and files');
const dash = await page.locator('#dash').innerText();
ok(dash.includes('$8,239') && dash.includes('3/5'), 'dashboard totals + carnet-ready 3/5: ' + dash.replace(/\s+/g, ' '));
await page.fill('#q', 'RK2U'); ok((await page.locator('.gear').count()) === 1, 'search by serial'); await page.fill('#q', '');
await shot(page, 'desktop-gear-list.png');

// ----- kits -----
await page.click('#nav [data-view=kits]'); await page.click('[data-act=newKit]');
await page.fill('#kName', 'Rack A');
for (const n of ['Playback PC', 'Audio interface', 'HDMI cables']) await page.locator('.overlay .pick', { hasText: n }).click();
await page.click('.overlay [data-act=saveKit]');
await page.click('[data-act=newKit]'); await page.fill('#kName', 'Laptop bag'); await page.selectOption('#kType', 'Bag');
await page.locator('.overlay .pick', { hasText: 'Show laptop A' }).click(); await page.click('.overlay [data-act=saveKit]'); await settled(page);
T = await fdb(page);
ok(T.kits.length === 2 && T.kit_items.length === 4, 'kits + kit_items saved to cloud');
await shot(page, 'desktop-kits.png');

// ----- trip / carnet -----
await page.click('#nav [data-view=trips]'); await page.click('[data-act=newTrip]');
await page.fill('[data-tf=name]', 'SAMPLE Corporate GS — London'); await page.press('[data-tf=name]', 'Tab');
await page.fill('[data-tf=destinations]', 'United Kingdom, France'); await page.press('[data-tf=destinations]', 'Tab');
await page.fill('[data-tf=depart]', '2026-11-02'); await page.fill('[data-tf=ret]', '2026-11-09'); await page.press('[data-tf=ret]', 'Tab');
await page.fill('[data-tf=holder]', 'Don Duckworth'); await page.press('[data-tf=holder]', 'Tab');
await page.locator('[data-act=toggleTripKit]', { hasText: 'Rack A' }).click();
await page.locator('[data-act=toggleTripKit]', { hasText: 'Laptop bag' }).click();
await page.click('[data-act=pickTripItems]'); await page.locator('.overlay .pick', { hasText: 'Starlink' }).click();
await page.click('.overlay [data-act=saveTripItems]'); await settled(page);
ok((await page.locator('#tripLines tbody tr').count()) === 5, 'trip general list has 5 lines');
let issues = await page.locator('#carnetIssues').innerText();
ok(issues.includes('1 missing serial') && issues.includes('1 missing country of origin'), 'pre-export flags: ' + issues.replace(/\s+/g, ' '));
await page.click('#view [data-act=csvCarnet]');
let csvPath = await dl(page, () => page.click('.overlay [data-r="1"]'));
let csv = fs.readFileSync(csvPath, 'utf8');
ok(csv.startsWith('\uFEFF') && csv.includes('SAMPLE-RK2U-0042') && /TOTAL,,10,/.test(csv), 'carnet CSV exported');
await page.locator('#tripLines tr', { hasText: 'Starlink' }).locator('[data-act=editItem]').click();
await page.fill('.overlay [data-f=origin]', 'Taiwan'); await page.click('.overlay [data-act=saveItem]');
await page.locator('#tripLines tr', { hasText: 'HDMI' }).locator('[data-act=editItem]').click();
await page.fill('.overlay [data-f=serial]', 'N/A-BULK-SAMPLE'); await page.click('.overlay [data-act=saveItem]'); await settled(page);
ok((await page.locator('#carnetIssues').innerText()).includes('Every line'), 'Fix flow: all lines complete');
await page.locator('#tripLines tr', { hasText: 'Audio interface' }).locator('[data-act=excludeLine]').click(); await settled(page);
T = await fdb(page);
ok(T.trip_items.some(r => r.mode === 'exclude') && (await page.locator('#tripLines tbody tr').count()) === 4, 'leave-off-this-trip saved as trip_items mode=exclude');
await page.click('[data-act=restoreLine]'); await settled(page);
T = await fdb(page);
ok(T.trips.length === 1 && T.trip_kits.length === 2 && T.trip_items.length === 1 && T.trip_items[0].mode === 'include', 'trip, trip_kits, trip_items in cloud');
await shot(page, 'desktop-trip.png', { fullPage: true });
await page.click('#view [data-act=previewCarnet]'); await page.waitForSelector('#printRoot.show .paper');
ok((await page.locator('.paper tbody tr').count()) === 5, 'general list preview');
await page.emulateMedia({ media: 'print' }); await page.setViewportSize({ width: 1100, height: 850 });
await shot(page, 'carnet-print.png', { fullPage: true });
await page.pdf({ path: OUT + 'carnet-general-list-sample.pdf', format: 'Letter', landscape: true, printBackground: true });
await page.emulateMedia({ media: 'screen' }); await page.setViewportSize({ width: 1440, height: 900 });
await page.click('.paperbar [data-act=closePaper]');

// ----- reload: session persists at aal2, data comes from the cloud -----
await page.reload(); await unlocked(page); await page.waitForSelector('.gear');
ok((await page.locator('.gear').count()) === 5, 'reload → still aal2, data reloaded from cloud');
// ----- another device edits → refresh on focus -----
await page.evaluate(id => __fakeSb.insert('items', { id: crypto.randomUUID(), owner_id: id, name: 'SAMPLE Added on iPad', category: 'Other', make: '', model: '', serial: 'SAMPLE-IPAD-1', qty: 1, status: 'active', currency: 'USD', vendor: '', origin: 'China', weight_unit: 'kg', notes: '', tags: [], price: 10 }), DON);
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForFunction(() => document.querySelectorAll('.gear').length === 6);
ok(true, 'refresh on focus picks up changes made on another device');
// ----- failed save → retry -----
await page.evaluate(() => { __fakeSb.failNext = 1; });
await page.locator('.gear', { hasText: 'Added on iPad' }).click(); await page.fill('.overlay [data-f=vendor]', 'Retry test'); await page.click('.overlay [data-act=saveItem]');
await page.waitForFunction(() => /NOT SAVED/.test(document.getElementById('netBadge').textContent));
ok(true, 'failed cloud save shows NOT SAVED badge');
await page.click('#netBadge'); await settled(page);
T = await fdb(page);
ok(T.items.some(i => i.vendor === 'Retry test'), 'retry pushes the pending change');
await page.locator('.gear', { hasText: 'Added on iPad' }).click(); await page.click('.overlay [data-act=deleteItem]'); await page.click('.overlay:last-child [data-r="1"]'); await settled(page);

// ----- offline: opens read-only from the IndexedDB cache -----
await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.gear');
ok((await page.locator('.gear').count()) === 5, 'OFFLINE reload opens the cached copy (service worker + IndexedDB)');
ok((await page.locator('#netBadge').innerText()).includes('OFFLINE'), 'offline badge shown');
await page.waitForFunction(() => document.querySelector('.gear .thumb img')?.naturalWidth > 0);
ok(true, 'thumbnails available offline from cache');
await page.click('#addBtn'); await page.waitForTimeout(150);
ok((await page.locator('.overlay').count()) === 0 && (await page.locator('#toast').innerText()).includes('read-only'), 'editing blocked offline (read-only)');
await page.locator('.gear', { hasText: 'Show laptop A' }).click(); await page.fill('.overlay [data-f=name]', 'changed offline'); await page.click('.overlay [data-act=saveItem]');
ok((await fdb(page)).items.every(i => i.name !== 'changed offline'), 'offline save refused, nothing written');
await page.click('.overlay [data-act=cancelEdit]');
await shot(page, 'desktop-offline.png');
await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForFunction(() => /RECONNECT/.test(document.getElementById('netBadge').textContent));
await Promise.all([page.waitForNavigation(), page.click('#netBadge')]); await unlocked(page); await settled(page);
ok((await page.locator('#netBadge').innerText()).includes('SYNCED'), 'tap badge when back online → reconnects');

// ----- backup export / erase / restore -----
await page.click('#nav [data-view=data]');
const bkPath = await dl(page, () => page.click('[data-act=exportBackup]'));
const bk = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
ok(bk.format === 2 && bk.data.items.length === 5 && Object.keys(bk.files).length === 3 && Object.values(bk.files).every(f => f.data.startsWith('data:')), 'backup JSON from cloud: 5 items + 3 files base64');
await shot(page, 'desktop-data.png');
await page.click('[data-act=eraseAll]'); await page.click('.overlay [data-r="1"]'); await page.waitForFunction(() => /erased/.test(document.getElementById('toast').textContent)); await settled(page);
T = await fdb(page);
ok(T.items.length === 0 && T.kits.length === 0 && T.trips.length === 0 && T.attachments.length === 0 && (await page.evaluate(() => __fakeSb.objects())).length === 0, 'erase all clears cloud rows + storage ' + JSON.stringify([T.items.length, T.kits.length, T.trips.length, T.attachments.length, await page.evaluate(() => __fakeSb.objects())]));
await page.setInputFiles('#view input[data-import=backup]', bkPath); await page.click('.overlay [data-r=replace]');
await page.waitForFunction(() => /^Restored/.test(document.getElementById('toast').textContent), null, { timeout: 15000 }); await settled(page);
T = await fdb(page);
ok(T.items.length === 5 && T.kits.length === 2 && T.kit_items.length === 4 && T.trips.length === 1 && T.attachments.length === 3, 'restore backup → cloud rows back');
ok((await page.evaluate(() => __fakeSb.objects())).length === 6, 'restore backup → files re-uploaded (3 images + 3 thumbs)');
// CSV import
fs.writeFileSync(TMP + 'import.csv', 'Description,Brand,Model,Serial Number,Price,Country of Origin,Category,Tags\nSAMPLE Dock,CalDigit,TS4,SAMPLE-TS4-9,399.99,China,Docking station / hub,dock; spare\n');
await page.setInputFiles('#view input[data-import=csv]', TMP + 'import.csv'); await settled(page);
await page.waitForFunction(() => __gv.S.items.length === 6); await settled(page);
T = await fdb(page);
ok(T.items.some(i => i.model === 'TS4' && i.make === 'CalDigit'), 'CSV import saved to cloud');

// ----- sign out → sign in again → TOTP challenge (not enrollment) -----
await page.click('[data-act=signOut]'); await page.waitForSelector('#auth #email');
ok(await page.evaluate(() => window.__gv.Cache.kvGet('state').then(v => !v)), 'sign out clears the offline cache');
await signIn(page); await page.waitForSelector('#auth #code');
ok((await authTitle(page)) === 'TWO-FACTOR CHECK' && (await page.locator('#qr').count()) === 0, 'next sign-in asks for a TOTP code (challenge), not enrollment');
await shot(page, 'desktop-mfa-challenge.png');
await code(page, '111111'); await page.waitForSelector('#auth .auth-err:not([hidden])');
ok(await page.locator('.topbar').isHidden(), 'wrong code → still locked');
await code(page); await unlocked(page); await page.waitForSelector('.gear');
ok((await page.locator('.gear').count()) === 6, 'challenge passed → data');

// ----- password reset -----
await page.click('#nav [data-view=data]'); await page.click('[data-act=signOut]'); await page.waitForSelector('[data-go=forgot]');
await page.click('[data-go=forgot]'); await page.fill('#email', EMAIL); await submit(page);
await page.waitForFunction(() => /CHECK YOUR EMAIL/.test(document.querySelector('#auth').innerText));
log = await page.evaluate(() => __fakeSb.log.filter(l => l.op === 'reset'));
ok(log.length === 1 && log[0].redirectTo === URL, 'password reset email requested with redirectTo = app URL');
ok(errs.length === 0, 'no console errors (desktop) ' + JSON.stringify(errs));
await ctx.close();

// recovery link → TOTP → new password
({ ctx, page, errs } = await newCtx({ width: 1280, height: 860 }, { opts: { recoveryEmail: EMAIL, users: [{ id: DON, email: EMAIL, password: PW, factors: [{ id: 'f1', factor_type: 'totp', friendly_name: 'GearVault', status: 'verified' }] }] }, url: URL + '#access_token=fake&type=recovery' }));
await page.waitForSelector('#auth #code');
ok((await authTitle(page)) === 'TWO-FACTOR CHECK', 'recovery link → TOTP challenge first');
await code(page); await page.waitForSelector('#auth #pw2');
ok((await authTitle(page)) === 'CHOOSE A NEW PASSWORD', 'then choose a new password');
await page.fill('#pw', 'short'); await page.fill('#pw2', 'short'); await submit(page);
ok((await page.locator('#auth .auth-err').innerText()).includes('12'), 'password length enforced');
await page.fill('#pw', 'a brand new long password'); await page.fill('#pw2', 'a brand new long password'); await submit(page);
await unlocked(page);
ok((await page.evaluate(() => __fakeSb.db.users[0].password)) === 'a brand new long password', 'password updated, app unlocked');
await ctx.close();

// ======================= 2. v1 on-device data → cloud upload offer =======================
({ ctx, page, errs } = await newCtx({ width: 1180, height: 820 }, { ctxOpts: { hasTouch: true } }));
await page.waitForSelector('#auth #email');
await page.evaluate(async ([photo]) => {
  const blob = new Blob([new Uint8Array(photo)], { type: 'image/png' });
  await window.__gv.Files.put('att_v1photo', blob, null);
  localStorage.setItem('showcrew.gearvault.v1', JSON.stringify({ v: 1, settings: { categories: ['Laptop – Mac', 'Other', 'My old category'], currency: 'USD', weightUnit: 'kg', holder: 'Don' },
    items: [{ id: 'itm_old1', name: 'SAMPLE v1 MacBook', category: 'Laptop – Mac', make: 'Apple', model: 'MacBook Pro', serial: 'SAMPLE-V1-1', price: 2000, origin: 'China', atts: [{ id: 'att_v1photo', name: 'v1.png', type: 'image/png', size: blob.size, kind: 'photo' }] },
      { id: 'itm_old2', name: 'SAMPLE v1 Interface', category: 'Other', serial: 'SAMPLE-V1-2', price: 300, origin: 'Germany', atts: [] }],
    kits: [{ id: 'kit_old', name: 'Old rack', type: 'Rack', itemIds: ['itm_old1', 'itm_old2'] }],
    trips: [{ id: 'trp_old', name: 'Old trip', kitIds: ['kit_old'], itemIds: [], excluded: ['itm_old2'] }] }));
}, [[...photoA]]);
await page.reload(); await signIn(page, { touch: true }); await code(page, CODE, true);
await page.waitForSelector('.overlay', { hasText: 'Gear found on this device' });
ok((await page.locator('.overlay').innerText()).includes('2 items'), 'first login offers to upload on-device v1 gear');
await shot(page, 'ipad-upload-offer.png');
await page.locator('.overlay [data-r=upload]').tap();
await page.waitForFunction(() => /^Uploaded/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
T = await fdb(page);
ok(T.items.length === 2 && T.items.every(i => /^[0-9a-f-]{36}$/.test(i.id)) && T.kits.length === 1 && T.kit_items.length === 2 && T.trip_items.some(r => r.mode === 'exclude'), 'v1 items/kits/trips uploaded with UUID ids + relations');
ok(T.attachments.length === 1 && (await page.evaluate(() => __fakeSb.objects())).length === 2, 'v1 photo uploaded (+ thumbnail)');
ok(T.categories.some(c => c.name === 'My old category'), 'v1 custom categories merged');
ok(await page.evaluate(() => !!localStorage.getItem('showcrew.gearvault.v1')), 'on-device copy kept until confirmed');
await page.locator('#nav [data-view=data]').tap();
ok(await page.locator('#legacyCard', { hasText: 'Uploaded to the cloud' }).isVisible(), 'Data tab confirms upload and offers to delete the local copy');
await page.locator('#legacyCard [data-act=uploadLegacy]').tap();
await page.waitForFunction(() => /^Uploaded/.test(document.getElementById('toast').textContent), null, { timeout: 15000 }); await settled(page);
T = await fdb(page);
ok(T.items.length === 2 && T.attachments.length === 1, 'uploading again creates no duplicates (deterministic ids)');
await page.locator('#legacyCard [data-act=deleteLegacy]').tap(); await page.locator('.overlay [data-r="1"]').tap(); await page.waitForFunction(() => /deleted/.test(document.getElementById('toast').textContent));
ok(await page.evaluate(() => !localStorage.getItem('showcrew.gearvault.v1')) && (await page.locator('#legacyCard').count()) === 0, 'local v1 copy deleted after confirmation');
// restore the desktop backup (merge) to have the full sample set for screenshots
await page.setInputFiles('#view input[data-import=backup]', bkPath); await page.locator('.overlay [data-r=merge]').tap();
await page.waitForFunction(() => /^Restored/.test(document.getElementById('toast').textContent), null, { timeout: 15000 }); await settled(page);
await page.locator('#nav [data-view=gear]').tap(); await page.waitForFunction(() => [...document.querySelectorAll('.gear .thumb img')].every(i => i.naturalWidth > 0));
ok((await page.locator('.gear').count()) === 7 && await noOverflow(page), 'iPad: merged data (7 items), no horizontal overflow');
await shot(page, 'ipad-landscape-gear.png');
await page.locator('#nav [data-view=trips]').tap(); await page.locator('.kcard', { hasText: 'London' }).tap(); await page.waitForSelector('#tripLines tbody tr');
await shot(page, 'ipad-landscape-trip.png');
ok(errs.length === 0, 'no console errors (iPad) ' + JSON.stringify(errs));
await ctx.close();

// ======================= 3. iPhone =======================
({ ctx, page, errs } = await newCtx({ width: 390, height: 844 }, { ctxOpts: { hasTouch: true, isMobile: true } }));
await shot(page, 'iphone-signin.png');
await signIn(page, { touch: true }); await page.waitForSelector('#auth #qr');
ok(await noOverflow(page), 'iPhone: enrollment screen fits');
await shot(page, 'iphone-mfa-enroll.png', { fullPage: true });
await code(page, CODE, true); await unlocked(page);
await page.locator('#nav [data-view=data]').tap();
await page.setInputFiles('#view input[data-import=backup]', bkPath); await page.locator('.overlay [data-r=replace]').tap();
await page.waitForFunction(() => /^Restored/.test(document.getElementById('toast').textContent), null, { timeout: 15000 }); await settled(page);
await addItem(page, { name: 'SAMPLE MacBook Air backup', category: 'Laptop – Mac', make: 'Apple', model: 'MacBook Air 13"', serial: 'SAMPLE-AIR-13', price: '1299', origin: 'China', weight: '2.7', weightUnit: 'lb' }, [['photo', 'air.png', 'image/png', photoA]], true);
ok((await fdb(page)).items.length === 6, 'iPhone: add item + photo by touch → cloud');
await page.locator('#nav [data-view=gear]').tap(); await page.waitForFunction(() => [...document.querySelectorAll('.gear .thumb img')].every(i => i.naturalWidth > 0));
ok(await noOverflow(page), 'iPhone: no horizontal overflow');
await shot(page, 'iphone-gear.png');
await page.locator('#nav [data-view=trips]').tap(); await page.locator('.kcard').first().tap(); await page.waitForSelector('#tripLines tbody tr');
ok(await noOverflow(page), 'iPhone: trip page fits');
await shot(page, 'iphone-trip.png', { fullPage: true });
ok(errs.length === 0, 'no console errors (iPhone) ' + JSON.stringify(errs));
await ctx.close();
await browser.close();
console.log(results.join('\n'));
console.log(fails ? `\n${fails} FAILED of ${results.length}` : `\nALL ${results.length} PASS`);
process.exit(fails ? 1 : 0);
