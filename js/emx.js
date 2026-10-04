// ShowCrew GearVault — Electromaxx gear number helpers (pure, no DOM). Tested by tools/test-carnet.mjs.
// The Electromaxx # is a 6-digit asset number printed (with a barcode) on a sticker on each piece of gear.
export const EMX_RE = /^\d{6}$/;
export const isEmx = v => EMX_RE.test(String(v ?? ''));
/** Strict normalizer used for stored data: exactly 6 digits, else ''. */
export const normEmx = v => { const s = String(v ?? '').trim(); return EMX_RE.test(s) ? s : ''; };
/** Lenient normalizer for spreadsheets: Excel turns 004217 into 4217, so 1–6 digit numbers are zero-padded. */
export function looseEmx(v) {
  const s = String(v ?? '').trim().replace(/\.0+$/, '').replace(/^#\s*/, '');
  if (/^\d{1,6}$/.test(s)) return s.padStart(6, '0');
  return '';
}

/** GS1 mod-10 check digit validation for EAN-8 / UPC-A / EAN-13 / GTIN-14 (also used by ITF-14). */
export function gs1Valid(d) {
  if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return false;
  let sum = 0;
  for (let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += +d[i] * w;
  return (10 - (sum % 10)) % 10 === +d[d.length - 1];
}

/**
 * Pull the 6-digit Electromaxx number out of whatever a barcode/QR contained.
 *   "004217"                         → "004217"
 *   "EMX-004217", URL …/gear/004217  → "004217"   (a 6-digit run not touching other digits)
 *   EAN-13/UPC-A/EAN-8 "0000000042170" (valid check digit, ≤6 significant digits) → "004217"
 *   all-digit codes with ≤6 significant digits (e.g. ITF "00004217") → "004217"
 * Returns { emx, raw, candidates } — emx is null when nothing unambiguous was found (candidates lists 6-digit runs).
 */
export function emxFromScan(text) {
  const raw = String(text ?? '').replace(/[\u0000-\u001f]/g, '').trim();
  const runs = [...raw.matchAll(/(?<!\d)\d{6}(?!\d)/g)].map(m => m[0]);
  const uniq = [...new Set(runs)];
  if (uniq.length === 1) return { emx: uniq[0], raw, candidates: uniq };
  if (uniq.length > 1) return { emx: null, raw, candidates: uniq };
  const digits = raw.replace(/\s+/g, '');
  if (/^\d{7,14}$/.test(digits)) {
    const body = gs1Valid(digits) ? digits.slice(0, -1) : digits;
    const sig = body.replace(/^0+/, '');
    if (sig.length >= 1 && sig.length <= 6) return { emx: sig.padStart(6, '0'), raw, candidates: [] };
  }
  return { emx: null, raw, candidates: [] };
}

/** Items (other than `exceptId`) that already use this number. */
export const emxOwners = (items, emx, exceptId) => (emx ? items.filter(i => i.emx === emx && i.id !== exceptId) : []);

/** Clear duplicate numbers in place (first item keeps it). Returns the items that lost their number. */
export function dedupeEmx(items) {
  const seen = new Set(), cleared = [];
  for (const i of items) { if (!i.emx) continue; if (seen.has(i.emx)) { cleared.push({ id: i.id, emx: i.emx }); i.emx = ''; } else seen.add(i.emx); }
  return cleared;
}
