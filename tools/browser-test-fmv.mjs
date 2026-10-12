// v2.3 headless checks: Update values (fair market value) with a mocked supabase.functions.invoke (tools/fake-supabase.js + window.__fakeFn).
// Serve this folder, then: GV_URL=http://127.0.0.1:8766/ node tools/browser-test-fmv.mjs   — all sample data is marked SAMPLE and exists only in this run.
import { chromium, devices } from 'playwright';
const URL = process.env.GV_URL || 'http://127.0.0.1:8766/';
const OUT = new globalThis.URL('../screenshots/', import.meta.url).pathname;
const FAKE = new globalThis.URL('./fake-supabase.js', import.meta.url).pathname;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const DON = '0d0d0d0d-1111-4222-8333-444455556666';
const browser = await chromium.launch();
async function session(ctxOpts) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, ...ctxOpts });
  await ctx.addInitScript({ path: FAKE }); await ctx.route(/supabase\.(co|in)\//, r => r.abort()); await ctx.route(/serpapi\.com/, r => r.abort());
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('#auth #email'); await page.fill('#email', 'don@example.com'); await page.fill('#pw', 'correct horse battery'); await page.click('#auth button[type=submit]');
  await page.waitForSelector('#auth #code'); await page.fill('#code', '246810'); await page.click('#auth button[type=submit]');
  await page.waitForFunction(() => !document.body.classList.contains('locked') && window.__gv?.cloud?.ready);
  return { ctx, page, errs };
}
const settled = page => page.waitForFunction(() => /SYNCED/.test(document.getElementById('netBadge').textContent), null, { timeout: 10000 });
const fdb = page => page.evaluate(() => { __fakeSb.reload(); return __fakeSb.db.tables; });
const hideToast = async page => { await page.evaluate(() => document.getElementById('toast').classList.remove('show')); await page.waitForTimeout(250); };
const ID = { mbp: 'aaaaaaaa-0000-4000-8000-000000000001', studio: 'aaaaaaaa-0000-4000-8000-000000000002', ram: 'aaaaaaaa-0000-4000-8000-000000000003', eur: 'aaaaaaaa-0000-4000-8000-000000000004', odd: 'aaaaaaaa-0000-4000-8000-000000000005', sold: 'aaaaaaaa-0000-4000-8000-000000000006' };
async function seed(page) {
  await page.evaluate(([ID, DON]) => {
    const base = { owner_id: DON, category: 'Other', qty: 1, status: 'active', currency: 'USD', vendor: '', origin: 'China', weight_unit: 'kg', notes: '', tags: [], make: '', model: '' };
    const add = r => __fakeSb.insert('items', { ...base, ...r });
    add({ id: ID.mbp, name: 'SAMPLE Show laptop A', make: 'Apple', model: 'MacBook Pro 16 M3 Max', serial: 'SAMPLE-C02XYZ', price: 3499, current_value: 2500 });
    add({ id: ID.studio, name: 'SAMPLE Mac Studio', make: 'Apple', model: 'Mac Studio M2 Ultra', serial: 'SAMPLE-MS1', price: 3999 });
    add({ id: ID.ram, name: 'SAMPLE 64GB RAM', make: 'Crucial', model: 'DDR5 64GB', serial: 'SAMPLE-RAM', price: 180, parent_id: ID.studio, part_type: 'installed' });
    add({ id: ID.eur, name: 'SAMPLE RME interface', make: 'RME', model: 'Fireface UFX III', serial: 'SAMPLE-RME', price: 2400, currency: 'EUR' });
    add({ id: ID.odd, name: 'SAMPLE Zzqx custom box', serial: 'SAMPLE-ZZ', price: 50 });
    add({ id: ID.sold, name: 'SAMPLE Old dock', make: 'CalDigit', model: 'TS3', serial: 'SAMPLE-TS3', price: 200, status: 'sold' });
  }, [ID, DON]);
  await settled(page); await page.evaluate(() => window.__gv.refreshFromCloud(true)); await page.waitForFunction(() => window.__gv.S.items.length === 6);
}
const MOCK = () => {
  window.__fnCalls = [];
  window.__fakeFn = async (name, body) => {
    window.__fnCalls.push(body.items.length);
    const P = { macbook: [2899, 3099, 2999, 3199, 9999, 49], studio: [3599, 3799, 3699, 3899], rme: [2190, 2290], fireface: [2190, 2290], 'ddr5': [150, 170, 160, 155] };
    return { status: 200, body: { checked_at: '2026-10-12T18:00:00.000Z', results: body.items.map(it => {
      const k = Object.keys(P).find(k => it.query.toLowerCase().includes(k));
      if (!k) return { item_id: it.item_id, query: it.query, median: null, low: null, high: null, count: 0, total: 0, currency: 'USD', sources: [] };
      const prices = P[k], est = window.__gv.Fmv.estimate(prices);
      return { item_id: it.item_id, query: it.query, ...est, currency: 'USD', sources: prices.slice(0, 3).map((p, i) => ({ title: `SAMPLE ${k} listing ${i + 1}`, source: ['Best Buy', 'B&H', 'eBay'][i], price: p, link: `https://example.com/${k}/${i}` })) };
    }) } };
  };
};

// ===== desktop =====
let { ctx, page, errs } = await session({ viewport: { width: 1440, height: 900 } });
await seed(page);
ok(await page.locator('[data-act=fmvOpen]').isEnabled(), 'Update values button on Gear tab, enabled online');
// no key configured → clear message
await page.click('[data-act=fmvOpen]'); await page.waitForSelector('#fmvGo');
ok(/4 items/.test(await page.locator('#fmvCount').innerText()), 'default scope all: skips installed part + sold gear (4 items) — ' + await page.locator('#fmvCount').innerText());
await page.check('#fmvInstalled'); ok(/5 items/.test(await page.locator('#fmvCount').innerText()), 'include installed → 5');
await page.uncheck('#fmvInstalled');
ok(/100 searches a month/.test(await page.locator('.overlay').innerText()) && /new retail/.test(await page.locator('.overlay').innerText()), 'quota + new-retail warnings shown');
await page.click('#fmvGo'); await page.waitForSelector('#fmvMsg .warn');
const mk = await page.locator('#fmvMsg').innerText();
ok(/SERPAPI_KEY/.test(mk) && (await page.locator('#fmvMsg a').getAttribute('href')).endsWith('/functions/secrets'), 'missing_key → message names SERPAPI_KEY + links the secrets page');
ok(await page.locator('#fmvApply').isDisabled(), 'nothing to apply after missing_key');
await page.click('.overlay [data-close]');
// with prices
await page.evaluate(MOCK);
await page.click('[data-act=fmvOpen]'); await page.click('input[value=novalue]');
ok(/3 items/.test(await page.locator('#fmvCount').innerText()), 'scope "without current value" → 3 (installed RAM + sold excluded)');
await page.click('input[value=all]'); await page.click('#fmvGo');
await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span').textContent));
const sent = await page.evaluate(() => window.__gv.layers.at(-1)._rows.map(r => r.query));
ok(sent.every(q => !/sample|SAMPLE-/i.test(q)) && sent.includes('Apple MacBook Pro 16 M3 Max Show laptop A'), 'queries built client-side without SAMPLE / serials: ' + JSON.stringify(sent));
const rows = page.locator('#fmvBody tr');
ok(await rows.count() === 4, 'review table has 4 rows');
const mbpRow = rows.filter({ hasText: 'Show laptop A' });
ok(/\$3,049/.test(await mbpRow.locator('.sug').innerText()) && /\$2,899–\$3,199/.test(await mbpRow.innerText()) && (await mbpRow.locator('.src a').count()) === 3, 'MacBook: IQR median $3,049, range, 3 source links');
ok(await rows.filter({ hasText: 'RME' }).locator('[data-fmvck]').isDisabled(), 'EUR item cannot be applied (value is USD)');
const odd = rows.filter({ hasText: 'Zzqx' });
ok(/No prices found/.test(await odd.innerText()) && await odd.locator('[data-fmvck]').isDisabled(), 'no-results row handled');
await odd.locator('[data-fmvq]').fill('Apple Mac Studio M2 Ultra'); await odd.locator('[data-fmvretry]').click();
await page.waitForFunction(() => [...document.querySelectorAll('#fmvBody tr')].some(t => /Zzqx/.test(t.textContent) && /\$3,749/.test(t.textContent)));
ok(true, 'edited query + retry on one row → result');
await hideToast(page); await page.locator('.overlay .modal-card').screenshot({ path: OUT + 'desktop-fmv-review.png' });
ok((await fdb(page)).items.find(i => i.id === ID.mbp).current_value === 2500, 'nothing changed before Apply');
await rows.filter({ hasText: 'Show laptop A' }).locator('[data-fmvck]').uncheck();
ok(/2 of 4 selected/.test(await page.locator('#fmvSel').innerText()), 'checkbox deselects');
await page.click('#fmvApply'); await settled(page);
let t = (await fdb(page)).items; const by = id => t.find(i => i.id === id);
ok(by(ID.mbp).current_value === 2500 && by(ID.mbp).fmv_value == null, 'unchecked item untouched');
ok(by(ID.studio).current_value === 3749 && by(ID.studio).fmv_value === 3749 && by(ID.studio).fmv_low === 3599 && by(ID.studio).fmv_count === 4 && by(ID.studio).fmv_sources.length === 3 && by(ID.studio).fmv_query === 'Apple Mac Studio M2 Ultra' && by(ID.studio).fmv_checked_at, 'applied: current_value = median (whole $) + fmv_* stored');
ok(by(ID.odd).current_value === 3749 && by(ID.eur).current_value == null && by(ID.ram).fmv_value == null, 'retried row applied; EUR + installed untouched');
ok(/value checked Oct 12, 2026/.test(await page.locator('.gear[data-id="' + ID.studio + '"]').innerText()), '"value checked <date>" on the item');
ok(JSON.stringify(await page.evaluate(() => window.__fnCalls)) === '[4,1]', 'batched: one call for 4 items, 1 for the retry');
// per-item lookup from the editor
await page.click(`.gear[data-id="${ID.mbp}"]`); await page.waitForSelector('[data-act=fmvItem]');
await page.click('[data-act=fmvItem]'); await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span')?.textContent || ''));
await page.click('#fmvApply');
ok(await page.locator('[data-f=currentValue]').inputValue() === '3049' && /Value checked/.test(await page.locator('#fmvInfo').innerText()), 'editor: Look up value fills the field + shows checked info');
ok((await fdb(page)).items.find(i => i.id === ID.mbp).current_value === 2500, 'editor lookup not saved until Save');
await page.click('.overlay [data-act=saveItem]'); await settled(page);
ok((await fdb(page)).items.find(i => i.id === ID.mbp).current_value === 3049, 'saved after Save');
// offline
await ctx.setOffline(true); await page.waitForTimeout(300);
ok(await page.locator('[data-act=fmvOpen]').isDisabled(), 'Update values disabled offline');
await ctx.setOffline(false); await page.waitForTimeout(300);
ok(await page.locator('[data-act=fmvOpen]').isEnabled(), 're-enabled online');
// sw never caches function calls
const sw = await (await fetch(URL + 'sw.js')).text();
ok(/functions\)\\\/v1/.test(sw) || /functions/.test(sw.match(/const NEVER = .*/)[0]), 'sw bypasses /functions/v1/');
ok(/scgv-v2\.3\.0/.test(sw) && sw.includes("'./js/fmv.js'"), 'sw VERSION scgv-v2.3.0 precaches fmv.js');
ok(!errs.length, 'no console errors ' + errs.join(' | '));
await ctx.close();

// ===== iPhone =====
({ ctx, page, errs } = await session({ ...devices['iPhone 13'], deviceScaleFactor: 3 }));
await seed(page); await page.evaluate(MOCK);
await page.click('[data-act=fmvOpen]'); await page.click('#fmvGo');
await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span').textContent));
ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'iPhone: no page overflow (table scrolls inside)');
await hideToast(page); await page.screenshot({ path: OUT + 'iphone-fmv-review.png' });
ok(!errs.length, 'iPhone: no console errors ' + errs.join(' | '));
await ctx.close(); await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL FMV BROWSER TESTS PASS'); process.exit(fails ? 1 : 0);
