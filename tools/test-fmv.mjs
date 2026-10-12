// Unit tests for js/fmv.js (median / outlier filter / query builder / SerpApi parsing). Run: node tools/test-fmv.mjs
import * as F from '../js/fmv.js';
import fs from 'node:fs';
import * as M from '../js/cloudmap.js';
import * as Store from '../js/store.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(F.median([3, 1, 2]) === 2 && F.median([4, 1, 3, 2]) === 2.5 && F.median([]) === null, 'median odd/even/empty');
ok(eq(F.keepRange([100, 110, 120, 130, 5000]), [100, 110, 120, 130]), 'IQR drops high outlier');
ok(eq(F.keepRange([1, 900, 1000, 1100, 1200]), [900, 1000, 1100, 1200]), 'IQR drops low outlier (accessory/case listing)');
ok(eq(F.keepRange([50, 4000, 9000]), [50, 4000, 9000]), '<4 prices: keep all');
ok(eq(F.keepRange([0, -5, NaN, 10]), [10]), 'ignores non-positive / NaN');
let e = F.estimate([1999, 2199, 2099, 2299, 12999, 29]);
ok(e.median === 2149 && e.low === 1999 && e.high === 2299 && e.count === 4 && e.total === 6, 'estimate median/low/high/count ' + JSON.stringify(e));
e = F.estimate([]); ok(e.median === null && e.count === 0, 'estimate no results');
ok(F.applyValue(2149.5) === 2150 && F.applyValue(null) === null, 'apply rounds to whole dollars');
ok(F.buildQuery({ make: 'Apple', model: 'MacBook Pro 16" M3 Max', name: 'SAMPLE MacBook Pro show laptop', serial: 'C02XYZ123' }) === 'Apple MacBook Pro 16 M3 Max show laptop', 'query dedupes, strips SAMPLE + quotes: ' + F.buildQuery({ make: 'Apple', model: 'MacBook Pro 16" M3 Max', name: 'SAMPLE MacBook Pro show laptop' }));
ok(F.buildQuery({ make: 'Dell', model: '', name: 'Rack PC C02ABC999', serial: 'C02ABC999, X1' }) === 'Dell Rack PC', 'query drops serial');
ok(F.buildQuery({ make: '', model: '', name: 'Starlink Mini 004217', emx: '004217' }) === 'Starlink Mini', 'query drops Electromaxx #');
ok(F.buildQuery({ make: 'x'.repeat(300) }).length === F.MAX_QUERY, 'query length capped');
ok(F.cleanQuery('  a   b ') === 'a b', 'cleanQuery');
const p = F.parseShopping({ shopping_results: [
  { title: 'A', source: 'Best Buy', extracted_price: 2099, product_link: 'https://g.co/a' },
  { title: 'B', source: 'eBay', price: '$1,999.00', link: 'https://e.co/b', second_hand_condition: 'used' },
  { title: 'C', source: 'X', extracted_price: 0 }, { title: 'D', source: 'Y', extracted_price: 2199, link: 'javascript:alert(1)' }] });
ok(eq(p.prices, [2099, 1999, 2199]) && p.items[1].condition === 'used', 'parseShopping prices + condition');
const est = F.estimate(p.prices), src = F.pickSources(p.items, est);
ok(src.length === 2 && src[0].price === 2099 && src.every(s => s.link.startsWith('https://')), 'pickSources: https only, closest to median first');
ok(eq(F.parseShopping({}).prices, []), 'parseShopping no results');
ok(fs.readFileSync(new URL('../js/fmv.js', import.meta.url), 'utf8') === fs.readFileSync(new URL('../supabase/functions/fmv-lookup/fmv.js', import.meta.url), 'utf8'), 'Edge Function fmv.js is identical to js/fmv.js');
// two-source tests
{ const j = { organic_results: [
  { title: 'a', price: { raw: '$2,999.00', extracted: 2999 }, link: 'https://www.ebay.com/itm/1', condition: 'Pre-Owned', sold_date: 'Sold Oct 1, 2026' },
  { title: 'b', price: { from: { extracted: 2800 }, to: { extracted: 3200 } }, link: 'https://www.ebay.com/itm/2' },
  { title: 'ad', sponsored: true, price: { extracted: 10 }, link: 'https://x' }, { title: 'c', price: { raw: '$3,100' }, link: 'https://www.ebay.com/itm/3' }] };
  const p = F.parseEbay(j); ok(JSON.stringify(p.prices) === '[2999,2800,3100]' && p.sold === 1 && p.items[0].condition === 'Pre-Owned', 'parseEbay: extracted / from-range / raw, skips sponsored, counts sold');
  const st = F.sourceStats(p); ok(st.median === 2999 && st.count === 3 && st.sources.length === 3, 'sourceStats');
  ok(F.suggest({ ebay_sold: { median: 2999, count: 3 }, google_new: { median: 3500, count: 8 } }) === 'ebay_sold', 'suggest eBay when ≥3');
  ok(F.suggest({ ebay_sold: { median: 2999, count: 2 }, google_new: { median: 3500, count: 8 } }) === 'google_new', 'suggest Google when eBay <3');
  ok(F.suggest({ ebay_sold: { median: 2999, count: 2 }, google_new: { median: null, count: 0 } }) === 'ebay_sold', 'fallback to thin eBay when Google empty');
  ok(F.suggest({ ebay_sold: { error: 'sold_unavailable' }, google_new: { error: 'quota' } }) === null, 'suggest null when nothing');
  ok(F.searchesPerItem(['ebay_sold', 'google_new']) === 2 && F.searchesPerItem(['google_new']) === 1, 'quota cost per item'); }
{ const S = Store.emptyState(); const it = Store.makeItem(S.settings); it.name = 'X';
  it.fmv = Store.sanitizeFmv({ value: 2149, low: 1999, high: 2299, count: 4, checkedAt: '2026-10-12T18:00:00+00:00', query: 'Apple X', pick: 'ebay_sold', bySource: { ebay_sold: { median: 2000, low: 1800, high: 2200, count: 5, sources: [{ title: 'e', source: 'eBay', price: 2000, link: 'https://ebay.com/itm/1' }] } }, sources: [{ title: 'A', source: 'B', price: 2099, link: 'https://a' }, { title: 'bad', link: 'javascript:x' }] });
  S.items.push(it); const rows = M.rowsFromState(S, 'u'); const r = [...rows.items.values()][0];
  ok(r.fmv_value === 2149 && r.fmv_count === 4 && r.fmv_sources.links[1].link === '' && r.fmv_sources.pick === 'ebay_sold' && r.fmv_sources.ebay_sold.count === 5 && r.fmv_checked_at === '2026-10-12T18:00:00.000Z', 'fmv → row (unsafe link blanked)');
  const back = M.stateFromRows({ items: [{ ...r, created_at: '2026-01-01', updated_at: '2026-01-01' }] }).items[0];
  ok(JSON.stringify(back.fmv) === JSON.stringify(it.fmv), 'fmv row round-trip');
  const none = M.stateFromRows({ items: [{ ...r, fmv_value: null }] }).items[0]; ok(none.fmv === null, 'no fmv → null'); }
console.log(fails ? `${fails} FAILED` : 'ALL FMV TESTS PASS'); process.exit(fails ? 1 : 0);
