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
    window.__fnCalls.push([body.items.length, body.sources.join('+')]);
    const F = window.__gv.Fmv;
    const G = { macbook: [2899, 3099, 2999, 3199, 9999, 49], studio: [3599, 3799, 3699, 3899], fireface: [2190, 2290], ddr5: [150, 170, 160, 155] };
    const A = { macbook: { median: 2350, low: 2100, high: 2600, count: 1, quote: 'A used one typically sells for $2,100 to $2,600 depending on condition.', via: 'ai_mode', sources: [{ title: 'SAMPLE ref', source: 'Swappa', price: null, link: 'https://example.com/ai/1' }] } };
    const E = { macbook: [2100, 2200, 2300, 2250, 90], studio: [2600, 2800], ddr5: [80, 90, 85] };
    const blk = (P, k, src) => { if (!k || !P[k]) return { median: null, low: null, high: null, count: 0, total: 0, sources: [] }; const est = F.estimate(P[k]);
      return { ...est, sources: P[k].slice(0, 2).map((p, i) => ({ title: `SAMPLE ${k} ${i}`, source: src === 'ebay_sold' ? 'eBay' : ['Best Buy', 'B&H'][i], price: p, link: `https://example.com/${src}/${k}/${i}` })) }; };
    return { status: 200, body: { checked_at: '2026-10-12T18:00:00.000Z', sources: body.sources, results: body.items.map(it => {
      const q = it.query.toLowerCase(), k = Object.keys(G).find(k => q.includes(k));
      const out = { item_id: it.item_id, query: it.query };
      if (body.sources.includes('google_ai')) out.google_ai = (k && A[k]) || { median: null, low: null, high: null, count: 0, quote: 'Prices vary.', error: 'no_number', sources: [] };
      if (body.sources.includes('ebay_sold')) out.ebay_sold = blk(E, k, 'ebay_sold');
      if (body.sources.includes('google_new')) out.google_new = blk(G, k, 'google_new');
      out.suggested = F.suggest(out); return out;
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
ok(await page.locator('[data-fmvsrc=google_ai]').isChecked() && !(await page.locator('[data-fmvsrc=ebay_sold]').isChecked()) && !(await page.locator('[data-fmvsrc=google_new]').isChecked()), 'default source: Google AI only');
ok(/× 1 = <b>3 searches/.test(await page.locator('#fmvCount').innerHTML()), 'default cost 1 search/item');
await page.uncheck('[data-fmvsrc=google_ai]'); await page.check('[data-fmvsrc=ebay_sold]'); await page.check('[data-fmvsrc=google_new]');
ok(/3 items<\/b> × 2 = <b>6 searches/.test(await page.locator('#fmvCount').innerHTML()), 'scope "without current value" → 3 items × 2 sources = 6 searches');
await page.uncheck('[data-fmvsrc=ebay_sold]'); ok(/× 1 = <b>3 searches/.test(await page.locator('#fmvCount').innerHTML()), 'toggle off eBay → 1 search/item');
await page.check('[data-fmvsrc=ebay_sold]');
await page.click('input[value=all]'); await page.click('#fmvGo');
await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span').textContent));
const sent = await page.evaluate(() => window.__gv.layers.at(-1)._rows.map(r => r.query));
ok(sent.every(q => !/sample|SAMPLE-/i.test(q)) && sent.includes('Apple MacBook Pro 16 M3 Max Show laptop A'), 'queries built client-side without SAMPLE / serials: ' + JSON.stringify(sent));
const rows = page.locator('#fmvBody tr');
ok(await rows.count() === 4, 'review table has 4 rows');
const mbp = () => rows.filter({ hasText: 'Show laptop A' }), studio = () => rows.filter({ hasText: 'Mac Studio' });
ok(/\$2,225/.test(await mbp().locator('td.sc').nth(0).innerText()) && /suggested/.test(await mbp().locator('td.sc').nth(0).innerText()) && /\$3,049/.test(await mbp().locator('td.sc').nth(1).innerText()), 'MacBook: both medians shown, eBay sold ($2,225, IQR) suggested over Google ($3,049)');
ok(/suggested/.test(await studio().locator('td.sc').nth(1).innerText()) && /\$2,700/.test(await studio().locator('td.sc').nth(0).innerText()), 'Mac Studio: eBay has only 2 → Google suggested, eBay median still shown');
ok(await rows.filter({ hasText: 'RME' }).locator('[data-fmvck]').isDisabled(), 'EUR item cannot be applied (prices are USD)');
const odd = rows.filter({ hasText: 'Zzqx' });
ok(/No prices/.test(await odd.innerText()) && await odd.locator('[data-fmvck]').isDisabled(), 'no-results row handled');
await odd.locator('[data-fmvq]').fill('Apple Mac Studio M2 Ultra'); await odd.locator('[data-fmvretry]').click();
await page.waitForFunction(() => [...document.querySelectorAll('#fmvBody tr')].some(t => /Zzqx/.test(t.textContent) && /\$3,749/.test(t.textContent)));
ok(true, 'edited query + retry on one row → result');
// user picks Google for the MacBook, own value for Mac Studio
await mbp().locator('input[value=google_new]').check();
ok(/→ \$3,049/.test(await mbp().locator('.usev').innerText()), 'pick other source → Use shows Google $3,049');
await studio().locator('[data-fmvcustom]').fill('3300');
ok(/→ \$3,300/.test(await studio().locator('.usev').innerText()) && await studio().locator('input[value=manual]').isChecked(), 'own value typed → selected');
await page.evaluate(() => { document.activeElement.blur(); document.querySelector('.fmvwrap').scrollLeft = 0; }); await hideToast(page); await page.locator('.overlay .modal-card').screenshot({ path: OUT + 'desktop-fmv-review.png' });
ok((await fdb(page)).items.find(i => i.id === ID.mbp).current_value === 2500, 'nothing changed before Apply');
await odd.locator('[data-fmvck]').uncheck();
ok(/2 of 4 selected/.test(await page.locator('#fmvSel').innerText()), 'checkbox deselects');
await page.click('#fmvApply'); await settled(page);
let t = (await fdb(page)).items; const by = id => t.find(i => i.id === id);
ok(by(ID.odd).current_value == null && by(ID.odd).fmv_value == null, 'unchecked item untouched');
const m = by(ID.mbp);
ok(m.current_value === 3049 && m.fmv_value === 3049 && m.fmv_sources.pick === 'google_new' && m.fmv_sources.ebay_sold.median === 2225 && m.fmv_sources.google_new.count === 4 && m.fmv_sources.links.length === 2 && m.fmv_checked_at && m.fmv_query, 'applied Google pick; fmv_sources stores both sources: ' + JSON.stringify(m.fmv_sources).slice(0, 160));
ok(by(ID.studio).current_value === 3300 && by(ID.studio).fmv_sources.pick === 'manual' && by(ID.studio).fmv_sources.ebay_sold.count === 2, 'own value applied, both source stats kept');
ok(by(ID.eur).current_value == null && by(ID.ram).fmv_value == null, 'EUR + installed untouched');
ok(/valued 20\d\d-\d\d-\d\d · today/.test(await page.locator('.gear[data-id="' + ID.studio + '"]').innerText()) && by(ID.studio).value_as_of, 'Apply sets value_as_of = today; list shows "valued <date> · today"');
ok(JSON.stringify(await page.evaluate(() => window.__fnCalls)) === '[[4,"ebay_sold+google_new"],[1,"ebay_sold+google_new"]]', 'batched: one call for 4 items, 1 for the retry, both sources');
// per-item lookup from the editor (suggested = eBay sold for the MacBook)
await page.click(`.gear[data-id="${ID.mbp}"]`); await page.waitForSelector('[data-act=fmvItem]');
await page.click('[data-act=fmvItem]'); await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span')?.textContent || ''));
await page.click('#fmvApply');
ok(await page.locator('[data-f=currentValue]').inputValue() === '2225' && /eBay sold/.test(await page.locator('#fmvInfo').innerText()), 'editor: Look up value fills suggested eBay value + shows both sources');
ok((await fdb(page)).items.find(i => i.id === ID.mbp).current_value === 3049, 'editor lookup not saved until Save');
await page.click('.overlay [data-act=saveItem]'); await settled(page);
ok((await fdb(page)).items.find(i => i.id === ID.mbp).current_value === 2225, 'saved after Save');
// Google AI source (default) from the editor
await page.click(`.gear[data-id="${ID.mbp}"]`); await page.waitForSelector('[data-act=fmvItem]');
await page.evaluate(() => { window.__gvSetSrc = true; });
await page.click('[data-act=fmvItem]'); await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span')?.textContent || ''));
await page.click('.overlay [data-close]');
// run again with AI checked via the bulk dialog scoped to the filtered list
await page.click('.overlay [data-act=cancelEdit]');
await page.fill('#q', 'Show laptop'); await page.click('[data-act=fmvOpen]'); await page.click('input[value=filtered]');
await page.uncheck('[data-fmvsrc=ebay_sold]'); await page.uncheck('[data-fmvsrc=google_new]'); await page.check('[data-fmvsrc=google_ai]');
await page.click('#fmvGo'); await page.waitForFunction(() => /Done/.test(document.querySelector('#fmvProg span').textContent));
const aiCell = page.locator('#fmvBody tr').first().locator('td.sc').first();
ok(/\$2,350/.test(await aiCell.innerText()) && /suggested/.test(await aiCell.innerText()) && /typically sells for/.test(await aiCell.locator('.aiq').innerText()) && /\$2,100–\$2,600/.test(await aiCell.innerText()), 'Google AI: midpoint $2,350 suggested, range + quote snippet + reference link');
await page.click('#fmvApply'); await settled(page);
let mm = (await fdb(page)).items.find(i => i.id === ID.mbp);
ok(mm.current_value === 2350 && mm.fmv_sources.pick === 'google_ai' && /typically/.test(mm.fmv_sources.google_ai.quote), 'AI value applied, quote stored');
await page.fill('#q', '');

// ===== v2.4 value as of =====
await page.evaluate(([DON]) => {
  __fakeSb.insert('items', { id: 'aaaaaaaa-0000-4000-8000-000000000007', owner_id: DON, name: 'SAMPLE Old Starlink Mini', category: 'Other', make: 'Starlink', model: 'Mini', serial: 'SAMPLE-SL', qty: 1, status: 'active', currency: 'USD', vendor: '', origin: 'Taiwan', weight_unit: 'kg', notes: '', tags: [], price: 599, current_value: 450, value_as_of: '2024-05-01' });
  __fakeSb.insert('trips', { id: 'bbbbbbbb-0000-4000-8000-000000000001', owner_id: DON, name: 'SAMPLE EU tour', destinations: 'DE', currency: 'USD', weight_unit: 'kg', holder: '', purpose: '', carnet_no: '', notes: '', serial_in_desc: false, show_emx: false, fold_parts: false });
  ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000007'].forEach((item_id, position) => __fakeSb.insert('trip_items', { owner_id: DON, trip_id: 'bbbbbbbb-0000-4000-8000-000000000001', item_id, mode: 'include', position }));
}, [DON]);
await settled(page); await page.evaluate(() => window.__gv.refreshFromCloud(true)); await page.waitForFunction(() => window.__gv.S.trips.length === 1);
const OLD = 'aaaaaaaa-0000-4000-8000-000000000007';
ok(await page.locator(`.gear[data-id="${ID.mbp}"] .g-val.val-fresh`).count() === 1 && await page.locator(`.gear[data-id="${OLD}"] .g-val.val-stale`).count() === 1, 'list rows: green outline fresh, red outline stale');
ok(/value >1 yr old · valued 2024-05-01/.test(await page.locator(`.gear[data-id="${OLD}"] .g-val`).innerText()), 'stale row has text label (not color only)');
await page.selectOption('[data-filter=fStatus]', 'val:stale');
const staleNames = await page.locator('#gearList .gear .g-name').allInnerTexts();
ok(staleNames.includes('SAMPLE Old Starlink Mini') && !staleNames.includes('SAMPLE Show laptop A'), 'Gear filter "Value >1 yr old / no date": ' + staleNames.join(', '));
await page.selectOption('[data-filter=fStatus]', '');
await page.click(`.gear[data-id="${ID.mbp}"]`); await page.waitForSelector('#valFld');
ok(await page.locator('#valFld.val-fresh').count() === 1 && /✓ valued 20\d\d-\d\d-\d\d · today/.test(await page.locator('#valAge').innerText()) && (await page.locator('[data-f=valueAsOf]').inputValue()).length === 10, 'editor: green when valued today, Value as of date field filled');
await hideToast(page); await page.locator('.overlay .modal-card').screenshot({ path: OUT + 'desktop-editor-value-fresh.png' });
await page.click('.overlay [data-act=cancelEdit]');
await page.click(`.gear[data-id="${OLD}"]`); await page.waitForSelector('#valFld');
ok(await page.locator('#valFld.val-stale').count() === 1 && /value >1 yr old/.test(await page.locator('#valAge').innerText()), 'editor: red when older than a year');
await page.locator('#valFld').scrollIntoViewIfNeeded(); await hideToast(page); await page.locator('.overlay .modal-card').screenshot({ path: OUT + 'desktop-editor-value-stale.png' });
await page.fill('[data-f=currentValue]', '420');
const td = await page.evaluate(() => window.__gv.VD.todayISO());
ok(await page.locator('[data-f=valueAsOf]').inputValue() === td && await page.locator('#valFld.val-fresh').count() === 1, 'editing current value sets Value as of = today → green');
await page.fill('[data-f=valueAsOf]', '2025-01-01'); await page.dispatchEvent('[data-f=valueAsOf]', 'change');
ok(await page.locator('#valFld.val-stale').count() === 1, 'date stays editable (back-dated → red)');
await page.click('.overlay [data-act=cancelEdit]'); if (await page.locator('.overlay [data-r="1"]').count()) await page.click('.overlay [data-r="1"]');
await page.waitForFunction(() => !document.querySelector('.overlay')).catch(() => {});
// carnet warning
await page.click('#nav [data-view=trips]'); await page.click('[data-act=openTrip]'); await page.waitForSelector('#staleBanner');
const ban = await page.locator('#staleBanner').innerText();
ok(/SAMPLE Old Starlink Mini/.test(ban) && /SAMPLE 64GB RAM/.test(ban) && !/Show laptop/.test(ban) && /no fair value date/.test(ban), 'carnet banner lists stale items incl. installed part: ' + ban.replace(/\s+/g, ' ').slice(0, 200));
ok(await page.locator('#staleBanner [data-act=editItem]').count() === 2, 'Fix link per stale item');
await hideToast(page); await page.locator('#staleBanner').scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + 'desktop-carnet-stale-warning.png' });
await page.click('[data-act=fmvStale]'); await page.waitForSelector('#fmvGo');
ok(await page.locator('input[value=preset]').isChecked() && /2 items/.test(await page.locator('#fmvCount').innerText()), 'Update values from banner is scoped to the 2 stale items');
await page.click('.overlay [data-close]');
await page.click('[data-act=csvCarnet]'); await page.waitForSelector('.overlay .lbl');
if (/incomplete/.test(await page.locator('.overlay').innerText())) { await page.click('.overlay [data-r="1"]'); await page.waitForTimeout(200); }
const ovt = await page.locator('.overlay').last().innerText(); ok(/out of date/i.test(ovt), 'CSV export warns about out-of-date values first: ' + ovt.slice(0, 120));
await page.locator('.overlay').last().locator('[data-r="0"]').click();
await page.click('#nav [data-view=gear]');
// ===== v2.5 included accessory =====
await page.click(`.gear[data-id="${ID.studio}"]`); await page.waitForSelector('[data-act=addPart]');
await page.click('.overlay [data-act=addPart]'); await page.waitForSelector('.overlay [data-r=included]');
ok(/Included accessory — e\.g\. power supply; cost in main item, not on carnet/.test(await page.locator('.overlay [data-r=included]').textContent()), 'Add part chooser offers Included accessory: ' + await page.locator('.overlay [data-r=included]').textContent());
await hideToast(page); await page.locator('.overlay').last().locator('.modal-card').screenshot({ path: OUT + 'desktop-add-part-included.png' });
await page.click('.overlay [data-r=included]'); await page.waitForSelector('.overlay [data-f=name]');
await page.fill('.overlay [data-f=name]', 'SAMPLE Mac Studio PSU'); await page.fill('.overlay [data-f=emx]', '004301'); await page.fill('.overlay [data-f=serial]', 'SAMPLE-PSU-1'); await page.fill('.overlay [data-f=notes]', 'SAMPLE 370W internal cable');
ok(await page.locator('#valFld').isHidden() && await page.locator('.inclnote').isVisible(), 'included editor: value hidden, explanation shown');
await page.click('.overlay [data-act=saveItem]'); await settled(page);
await page.waitForSelector('.overlay [data-act=addPart]'); await page.click('.overlay [data-act=cancelEdit]'); await page.waitForFunction(() => !document.querySelector('.overlay'));
const psu = (await fdb(page)).items.find(i => i.name === 'SAMPLE Mac Studio PSU');
ok(psu && psu.part_type === 'included' && psu.parent_id === ID.studio && psu.electromaxx_no === '004301', 'saved with part_type included + own Electromaxx #');
const prow = page.locator(`.gear[data-id="${psu.id}"]`);
ok(await prow.locator('.pt.included').count() === 1 && /INCL\./.test(await prow.innerText()) && /not on carnet/.test(await prow.innerText()) && await prow.locator('.vage').count() === 0 && +(await prow.getAttribute('data-depth')) === 1, 'list: nested under parent, purple "included" tag, no value/red-green');
await prow.scrollIntoViewIfNeeded(); await hideToast(page); await page.screenshot({ path: OUT + 'desktop-gear-list-included-psu.png' });
await page.selectOption('[data-filter=fStatus]', 'val:stale');
ok(!(await page.locator('#gearList .gear .g-name').allInnerTexts()).includes('SAMPLE Mac Studio PSU'), 'not in stale filter');
await page.selectOption('[data-filter=fStatus]', '');
await page.fill('#q', '004301'); ok(/included with|part of/i.test(await page.locator('#gearList').innerText()) || (await page.locator('#gearList .gear').count()) === 1, 'Electromaxx # search finds the PSU'); await page.fill('#q', '');
// child editor: switch type
await prow.click(); await page.waitForSelector('#partOfStrip');
ok(/SAMPLE Mac Studio/.test(await page.locator('#partOfStrip').innerText()), 'PSU editor shows its parent');
await page.selectOption('#partOfStrip [data-f=partType]', 'accessory');
ok(await page.locator('#valFld').isVisible(), 'switching to Separate accessory shows the value field');
await page.selectOption('#partOfStrip [data-f=partType]', 'included'); ok(await page.locator('#valFld').isHidden(), 'and back to Included hides it');
await page.click('.overlay [data-act=cancelEdit]'); if (await page.locator('.overlay [data-r="1"]').count()) await page.locator('.overlay [data-r="1"]').last().click();
// FMV scope excludes it
await page.click('[data-act=fmvOpen]'); await page.check('#fmvInstalled'); await page.check('#fmvInactive');
const allCount = await page.evaluate(() => window.__gv.S.items.length);
ok(new RegExp(`${allCount - 1} items`).test(await page.locator('#fmvCount').innerText()), 'FMV scope never includes included accessories');
await page.click('.overlay [data-close]');
// trip: not on the carnet, but in the picker as "included with"
await page.click('#nav [data-view=trips]'); await page.click('[data-act=openTrip]'); await page.waitForSelector('#tripLines');
ok(!/Mac Studio PSU/.test(await page.locator('#tripLines table').innerText()) && !/Mac Studio PSU/.test(await page.locator('#staleBanner').innerText()), 'PSU not a carnet line and not in stale warning');
await page.click('[data-act=pickTripItems]'); await page.waitForSelector('.overlay .pick');
ok(/included with SAMPLE Mac Studio/.test(await page.locator('.overlay .pick', { hasText: 'Mac Studio PSU' }).innerText()), 'trip item picker shows "included with SAMPLE Mac Studio"');
await page.click('.overlay [data-act=cancelPick], .overlay [data-close], .overlay .iconbtn').catch(() => {});
if (await page.locator('.overlay').count()) await page.keyboard.press('Escape');
await page.click('#nav [data-view=gear]');
// offline
await ctx.setOffline(true); await page.waitForTimeout(300);
ok(await page.locator('[data-act=fmvOpen]').isDisabled(), 'Update values disabled offline');
await ctx.setOffline(false); await page.waitForTimeout(300);
ok(await page.locator('[data-act=fmvOpen]').isEnabled(), 're-enabled online');
// sw never caches function calls
const sw = await (await fetch(URL + 'sw.js')).text();
ok(/functions\)\\\/v1/.test(sw) || /functions/.test(sw.match(/const NEVER = .*/)[0]), 'sw bypasses /functions/v1/');
ok(/scgv-v2\.5\.0/.test(sw) && sw.includes("'./js/fmv.js'") && sw.includes("'./js/valdate.js'"), 'sw VERSION scgv-v2.5.0 precaches fmv.js + valdate.js');
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
