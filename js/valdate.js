// ShowCrew GearVault v2.4 — value freshness ("Value as of"). Pure; tested by tools/test-fmv.mjs.
export const FRESH_DAYS = 365;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const unitValue = i => (i.currentValue != null && i.currentValue !== '' ? Number(i.currentValue) : i.price != null && i.price !== '' ? Number(i.price) : null);
/** Local YYYY-MM-DD (the user's day, not UTC). */
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNo = s => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
export function ago(days) {
  if (days <= 0) return 'today';
  if (days < 31) return `${days} d ago`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30.44))} mo ago`;
  const y = Math.floor(days / 365.25); return `${Math.max(1, y)} yr ago`;
}
/** { state: 'none' | 'fresh' | 'stale', date, days, label, source }.
 *  The date is the item's Value as of; an item valued only by its purchase price falls back to its purchase date. */
export function valueAge(i, now = new Date()) {
  if (unitValue(i) == null || !Number.isFinite(unitValue(i))) return { state: 'none', date: '', days: null, label: 'no value', source: '' };
  const usesCurrent = i.currentValue != null && i.currentValue !== '';
  let date = DATE_RE.test(i.valueAsOf || '') ? i.valueAsOf : '', source = 'value';
  if (!date && !usesCurrent && DATE_RE.test(i.purchaseDate || '')) { date = i.purchaseDate; source = 'purchase'; }
  if (!date) return { state: 'stale', date: '', days: null, label: 'no value date', source: '' };
  const days = dayNo(todayISO(now)) - dayNo(date);
  const fresh = days <= FRESH_DAYS;
  const verb = source === 'purchase' ? 'purchased' : 'valued';
  return { state: fresh ? 'fresh' : 'stale', date, days, source, label: fresh ? `${verb} ${date} · ${ago(days)}` : `value >1 yr old · ${verb} ${date}` };
}
export const isStale = (i, now) => valueAge(i, now).state === 'stale';
