// ShowCrew GearVault v2.3 — fair-market-value helpers (pure; shared by the app and the fmv-lookup Edge Function).
// No DOM, no network. Tested by tools/test-fmv.mjs.
export const MAX_PER_CALL = 10;
export const MAX_QUERY = 150;

const median = xs => { const a = xs.slice().sort((x, y) => x - y), n = a.length; if (!n) return null; return n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2; };
const quantile = (a, q) => { const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return a[lo] + (a[hi] - a[lo]) * (pos - lo); };
export { median };

/** Drop outliers: IQR fence (1.5×IQR) when there are ≥ 4 prices, else keep all. Returns sorted kept prices. */
export function keepRange(prices) {
  const a = prices.filter(p => Number.isFinite(p) && p > 0).sort((x, y) => x - y);
  if (a.length < 4) return a;
  const q1 = quantile(a, 0.25), q3 = quantile(a, 0.75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return a.filter(p => p >= lo && p <= hi);
}
/** { median, low, high, count, total } — median of the kept range; null median when nothing usable. */
export function estimate(prices) {
  const all = prices.filter(p => Number.isFinite(p) && p > 0), kept = keepRange(all);
  if (!kept.length) return { median: null, low: null, high: null, count: 0, total: all.length };
  const r2 = v => Math.round(v * 100) / 100;
  return { median: r2(median(kept)), low: r2(kept[0]), high: r2(kept[kept.length - 1]), count: kept.length, total: all.length };
}

const SAMPLE_RE = /\bsample\b/gi;
/** Search text for an item: make + model + name (deduped words), never the serial / Electromaxx # / "SAMPLE". */
export function buildQuery(item) {
  const serials = String(item.serial || '').split(/[,;\s]+/).filter(s => s.length >= 4).map(s => s.toLowerCase());
  const emx = String(item.emx || '');
  const seen = new Set(), out = [];
  for (const part of [item.make, item.model, item.name]) {
    for (const w of String(part || '').replace(SAMPLE_RE, ' ').replace(/[()[\]{}"“”]/g, ' ').split(/\s+/)) {
      const t = w.trim(); if (!t) continue;
      const k = t.toLowerCase().replace(/[.,;:]+$/, '');
      if (!k || seen.has(k) || serials.includes(k) || (emx && k.includes(emx)) || /^s\/?n$/.test(k)) continue;
      seen.add(k); out.push(t.replace(/[.,;:]+$/, ''));
    }
  }
  return out.join(' ').slice(0, MAX_QUERY).trim();
}
/** Clean a user-edited query (no secrets/serials enforcement beyond length + whitespace). */
export const cleanQuery = q => String(q || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

/** Parse a SerpApi google_shopping response → { prices, sources(≤5) }. */
export function parseShopping(json, max = 5) {
  const rows = [...(json?.shopping_results || []), ...(json?.inline_shopping_results || [])];
  const items = [];
  for (const r of rows) {
    let p = Number(r.extracted_price);
    if (!Number.isFinite(p) && typeof r.price === 'string') p = parseFloat(r.price.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(p) || p <= 0) continue;
    items.push({ title: String(r.title || '').slice(0, 200), source: String(r.source || '').slice(0, 80), price: p,
      link: String(r.product_link || r.link || '').slice(0, 600), condition: String(r.second_hand_condition || r.condition || '').slice(0, 40) });
  }
  return { prices: items.map(i => i.price), items };
}
/** Pick up to n source links whose prices are inside the kept range, closest to the median first. */
export function pickSources(items, est, n = 5) {
  if (est.median == null) return [];
  return items.filter(i => i.price >= est.low && i.price <= est.high && /^https:\/\//.test(i.link))
    .sort((a, b) => Math.abs(a.price - est.median) - Math.abs(b.price - est.median)).slice(0, n);
}
/** Value applied to current_value: whole dollars. */
export const applyValue = m => (m == null ? null : Math.round(m));

// ---------- v2.3: two sources (same SERPAPI_KEY) ----------
export const SOURCES = ['ebay_sold', 'google_new'];
export const SOURCE_LABEL = { ebay_sold: 'eBay sold', google_new: 'Google new' };
export const EBAY_MIN = 3; // eBay sold median is suggested when it has at least this many kept prices
/** Parse a SerpApi engine=ebay response → { prices, items, sold } (sold = how many results carry a sold date / sold marker). */
export function parseEbay(json, max = 60) {
  const out = []; let sold = 0;
  for (const r of (json?.organic_results || []).slice(0, max)) {
    const pr = r.price || {};
    let p = Number(pr.extracted ?? pr.from?.extracted);
    if (!Number.isFinite(p) && typeof pr.raw === 'string') p = parseFloat(pr.raw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(p) || p <= 0 || r.sponsored) continue;
    const isSold = !!(r.sold_date || /sold/i.test(String(r.price?.raw || '') + ' ' + String(r.listing_status || '')));
    if (isSold) sold++;
    out.push({ title: String(r.title || '').slice(0, 200), source: 'eBay', price: p, link: String(r.link || '').slice(0, 600), condition: String(r.condition || '').slice(0, 40), sold: isSold });
  }
  return { prices: out.map(i => i.price), items: out, sold };
}
/** Stats block for one source: { median, low, high, count, total, sources[] }. */
export function sourceStats(parsed, n = 5) {
  const est = estimate(parsed.prices);
  return { ...est, sources: pickSources(parsed.items, est, n).map(({ title, source, price, link }) => ({ title, source, price, link })) };
}
/** Which source to suggest: eBay sold when it has ≥ EBAY_MIN kept prices, else Google, else whatever has a median. */
export function suggest(r) {
  const e = r?.ebay_sold, g = r?.google_new;
  if (e && !e.error && e.median != null && e.count >= EBAY_MIN) return 'ebay_sold';
  if (g && !g.error && g.median != null) return 'google_new';
  if (e && !e.error && e.median != null) return 'ebay_sold';
  return null;
}
export const searchesPerItem = srcs => SOURCES.filter(s => srcs.includes(s)).length;
