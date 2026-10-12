// ShowCrew GearVault v2.3 — fmv-lookup: estimate fair market value via SerpApi Google Shopping.
// Deployed with verify_jwt = true (the gateway rejects missing/invalid JWTs with 401). Additionally requires an MFA-verified (aal2) session.
// Secret: SERPAPI_KEY (Dashboard → Edge Functions → Secrets). The key is never returned or logged.
// fmv.js here is a copy of /js/fmv.js (tools/test-fmv.mjs checks they are identical).
import { parseShopping, parseEbay, sourceStats, suggest, cleanQuery, MAX_PER_CALL, SOURCES } from './fmv.js';

const ORIGINS = ['https://don-duckworth.github.io', 'http://localhost:8766', 'http://127.0.0.1:8766'];
const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store' };
};
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

function claims(req: Request): Record<string, unknown> | null {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+([^.]+)\.([^.]+)\.([^.]+)$/i);
  if (!m) return null;
  try { const b = m[2].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); } catch { return null; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function serp(key: string, params: Record<string, string>) {
  const url = 'https://serpapi.com/search.json?' + new URLSearchParams({ ...params, api_key: key });
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const body = await r.json().catch(() => ({}));
    const msg = String(body?.error || '');
    if (r.status === 401 || /invalid api key/i.test(msg)) return { error: 'bad_key' };
    if (r.status === 429 || /run out of searches|plan.*limit|searches per month/i.test(msg)) return { error: 'quota' };
    if (/hasn't returned any results|no results/i.test(msg)) return { body: {} };
    if (!r.ok || msg) return { error: 'upstream' };
    return { body };
  } catch (e) { return { error: (e as Error).name === 'AbortError' ? 'timeout' : 'upstream' }; }
  finally { clearTimeout(t); }
}
// google_new: Google Shopping (mostly new retail). ebay_sold: eBay sold + completed listings (LH_Sold / LH_Complete).
// NOTE (Sep 2026): SerpApi documents show_only=Sold/Complete as deprecated (eBay put sold results behind a login), so the sold search may come back
// empty or as active listings. We report `sold_verified` = how many returned results carry a sold marker, and flag `sold_unavailable` when none do.
async function googleNew(key: string, q: string) {
  const r = await serp(key, { engine: 'google_shopping', q, gl: 'us', hl: 'en' });
  if (r.error) return { error: r.error };
  return { ...sourceStats(parseShopping(r.body)), currency: 'USD' };
}
async function ebaySold(key: string, q: string) {
  const r = await serp(key, { engine: 'ebay', _nkw: q, ebay_domain: 'ebay.com', LH_Sold: '1', LH_Complete: '1', _ipg: '50' });
  if (r.error) return { error: r.error };
  const p = parseEbay(r.body);
  if (!p.prices.length) return { error: 'no_results', count: 0, median: null, sold_verified: 0 };
  if (!p.sold) return { error: 'sold_unavailable', sold_verified: 0, count: 0, median: null };
  const soldOnly = { prices: p.items.filter(i => i.sold).map(i => i.price), items: p.items.filter(i => i.sold) };
  return { ...sourceStats(soldOnly), currency: 'USD', sold_verified: p.sold };
}
async function lookup(key: string, q: string, srcs: string[]) {
  const [e, g] = await Promise.all([srcs.includes('ebay_sold') ? ebaySold(key, q) : null, srcs.includes('google_new') ? googleNew(key, q) : null]);
  const out: Record<string, unknown> = {};
  if (e) out.ebay_sold = e; if (g) out.google_new = g;
  const pick = suggest(out);
  const best = pick ? out[pick] as Record<string, unknown> : null;
  const fatal = [e, g].find(x => x && (x.error === 'bad_key' || x.error === 'quota'));
  return { ...out, suggested: pick, median: best?.median ?? null, low: best?.low ?? null, high: best?.high ?? null, count: best?.count ?? 0,
    sources: best?.sources ?? [], currency: 'USD', ...(fatal && !pick ? { error: fatal.error } : {}), ...(fatal ? { stop: fatal.error } : {}) };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
  const c = claims(req);
  if (!c || !c.sub) return json(req, 401, { error: 'unauthorized', message: 'Sign in first.' });
  if (c.aal !== 'aal2') return json(req, 403, { error: 'mfa_required', message: 'Two-factor verification is required.' });
  let body: { items?: { item_id?: string; query?: string }[]; sources?: string[] };
  try { body = await req.json(); } catch { return json(req, 400, { error: 'bad_request', message: 'JSON body expected.' }); }
  const list = Array.isArray(body?.items) ? body.items : null;
  if (!list || !list.length) return json(req, 400, { error: 'bad_request', message: 'items[] required.' });
  if (list.length > MAX_PER_CALL) return json(req, 400, { error: 'too_many', message: `At most ${MAX_PER_CALL} items per call.` });
  const srcs = Array.isArray(body?.sources) ? SOURCES.filter(x => body.sources!.includes(x)) : SOURCES.slice();
  if (!srcs.length) return json(req, 400, { error: 'bad_request', message: 'Pick at least one source.' });
  const key = Deno.env.get('SERPAPI_KEY');
  if (!key) return json(req, 503, { error: 'missing_key', message: 'SERPAPI_KEY secret is not set on this Supabase project.' });
  const results = [];
  for (const it of list) {
    const item_id = String(it?.item_id || ''), query = cleanQuery(it?.query);
    if (!UUID.test(item_id) || !query) { results.push({ item_id, query, error: 'bad_item' }); continue; }
    const r = await lookup(key, query, srcs);
    results.push({ item_id, query, ...r });
    if (r.stop) { // stop spending calls; mark the rest
      for (const rest of list.slice(results.length)) results.push({ item_id: String(rest?.item_id || ''), query: cleanQuery(rest?.query), error: 'skipped' });
      break;
    }
  }
  return json(req, 200, { results, sources: srcs, checked_at: new Date().toISOString() });
});
