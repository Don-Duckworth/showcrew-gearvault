// ShowCrew GearVault v2.3 — fmv-lookup: estimate fair market value via SerpApi Google Shopping.
// Deployed with verify_jwt = true (the gateway rejects missing/invalid JWTs with 401). Additionally requires an MFA-verified (aal2) session.
// Secret: SERPAPI_KEY (Dashboard → Edge Functions → Secrets). The key is never returned or logged.
// fmv.js here is a copy of /js/fmv.js (tools/test-fmv.mjs checks they are identical).
import { estimate, parseShopping, pickSources, cleanQuery, MAX_PER_CALL } from './fmv.js';

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

async function lookup(key: string, q: string) {
  const url = 'https://serpapi.com/search.json?' + new URLSearchParams({ engine: 'google_shopping', q, gl: 'us', hl: 'en', api_key: key });
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 || /invalid api key/i.test(body?.error || '')) return { error: 'bad_key' };
    if (r.status === 429 || /run out of searches|limit/i.test(body?.error || '')) return { error: 'quota' };
    if (!r.ok && !/hasn't returned any results/i.test(body?.error || '')) return { error: 'upstream', status: r.status };
    const { prices, items } = parseShopping(body);
    const est = estimate(prices);
    return { ...est, currency: 'USD', sources: pickSources(items, est, 5) };
  } catch (e) { return { error: (e as Error).name === 'AbortError' ? 'timeout' : 'upstream' }; }
  finally { clearTimeout(t); }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
  const c = claims(req);
  if (!c || !c.sub) return json(req, 401, { error: 'unauthorized', message: 'Sign in first.' });
  if (c.aal !== 'aal2') return json(req, 403, { error: 'mfa_required', message: 'Two-factor verification is required.' });
  let body: { items?: { item_id?: string; query?: string }[] };
  try { body = await req.json(); } catch { return json(req, 400, { error: 'bad_request', message: 'JSON body expected.' }); }
  const list = Array.isArray(body?.items) ? body.items : null;
  if (!list || !list.length) return json(req, 400, { error: 'bad_request', message: 'items[] required.' });
  if (list.length > MAX_PER_CALL) return json(req, 400, { error: 'too_many', message: `At most ${MAX_PER_CALL} items per call.` });
  const key = Deno.env.get('SERPAPI_KEY');
  if (!key) return json(req, 503, { error: 'missing_key', message: 'SERPAPI_KEY secret is not set on this Supabase project.' });
  const results = [];
  for (const it of list) {
    const item_id = String(it?.item_id || ''), query = cleanQuery(it?.query);
    if (!UUID.test(item_id) || !query) { results.push({ item_id, query, error: 'bad_item' }); continue; }
    const r = await lookup(key, query);
    results.push({ item_id, query, ...r });
    if (r.error === 'bad_key' || r.error === 'quota') { // stop spending calls; mark the rest
      for (const rest of list.slice(results.length)) results.push({ item_id: String(rest?.item_id || ''), query: cleanQuery(rest?.query), error: 'skipped' });
      break;
    }
  }
  return json(req, 200, { results, checked_at: new Date().toISOString() });
});
