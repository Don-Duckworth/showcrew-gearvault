// Unit tests for js/fmv.js (median / outlier filter / query builder / SerpApi parsing). Run: node tools/test-fmv.mjs
import * as F from '../js/fmv.js';
import fs from 'node:fs';
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
console.log(fails ? `${fails} FAILED` : 'ALL FMV TESTS PASS'); process.exit(fails ? 1 : 0);
