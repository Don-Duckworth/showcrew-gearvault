// ShowCrew GearVault v2.2 — parent/child parts & accessories (pure helpers, no DOM). Tested by tools/test-carnet.mjs.
// item.parentId: id of the item it belongs to ('' = standalone). item.partType: 'installed' (inside the parent) | 'accessory'.
export const PART_TYPES = [['installed', 'Installed inside'], ['accessory', 'Separate accessory']];
export const partTypeOf = i => (i && i.parentId ? (i.partType === 'installed' ? 'installed' : 'accessory') : '');
export const normPartType = v => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/^(installed|inside|internal|built[- ]?in|in)\b|installed/.test(s)) return 'installed';
  if (/^(accessory|accessories|separate|external|loose|acc)\b|accessor/.test(s)) return 'accessory';
  return '';
};

const indexOf = items => (items instanceof Map ? items : new Map(items.map(i => [i.id, i])));
/** Map(parentId → [children]) in the items' own order. */
export function childIndex(items) {
  const m = new Map();
  for (const i of items) if (i.parentId) { if (!m.has(i.parentId)) m.set(i.parentId, []); m.get(i.parentId).push(i); }
  return m;
}
export const childrenOf = (items, id, kids = childIndex(items)) => kids.get(id) || [];
/** All descendants, depth-first (parent before its own parts). Cycle-safe. */
export function descendants(items, id, kids = childIndex(items)) {
  const out = [], seen = new Set([id]);
  const walk = pid => { for (const c of kids.get(pid) || []) { if (seen.has(c.id)) continue; seen.add(c.id); out.push(c); walk(c.id); } };
  walk(id); return out;
}
/** [parent, grandparent, …] — stops on a missing parent or a cycle. */
export function ancestors(items, id, byId = indexOf(items)) {
  const out = [], seen = new Set([id]); let cur = byId.get(id);
  while (cur && cur.parentId && !seen.has(cur.parentId)) { const p = byId.get(cur.parentId); if (!p) break; out.push(p); seen.add(p.id); cur = p; }
  return out;
}
export const depthOf = (items, id, byId = indexOf(items)) => ancestors(items, id, byId).length;
/** Would making `childId` a part of `parentId` create a loop? */
export function wouldCycle(items, childId, parentId, byId = indexOf(items)) {
  if (!parentId) return false;
  if (parentId === childId) return true;
  return parentId === childId || ancestors(items, parentId, byId).some(a => a.id === childId);
}
/** Clean up links in place: drop parents that don't exist, self-links and cycles; normalize partType. Returns ids that were unlinked. */
export function fixParents(items) {
  const byId = indexOf(items), cleared = [];
  for (const i of items) {
    if (i.parentId && (!byId.has(i.parentId) || i.parentId === i.id)) { cleared.push(i.id); i.parentId = ''; }
  }
  for (const i of items) {
    if (!i.parentId) continue;
    const seen = new Set([i.id]); let cur = byId.get(i.parentId);
    while (cur) { if (seen.has(cur.id)) { cleared.push(i.id); i.parentId = ''; break; } seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  }
  for (const i of items) i.partType = partTypeOf(i);
  return cleared;
}
/** Items ordered so every parent comes before its parts (roots first) — the order the database needs for one-statement upserts. */
export function parentsFirst(items) {
  const byId = indexOf(items), d = new Map(items.map(i => [i.id, depthOf(items, i.id, byId)]));
  return items.map((i, ix) => [i, ix]).sort((a, b) => d.get(a[0].id) - d.get(b[0].id) || a[1] - b[1]).map(x => x[0]);
}
/** Value of the item itself + every descendant (same currency only), and how many parts were included. */
export function valueWithParts(items, id, unitValue, kids = childIndex(items)) {
  const byId = indexOf(items), self = byId.get(id); if (!self) return { value: 0, parts: 0, other: 0 };
  const cur = self.currency || 'USD', val = i => (unitValue(i) || 0) * (i.qty || 1);
  let value = val(self), other = 0; const ds = descendants(items, id, kids);
  for (const c of ds) { if ((c.currency || 'USD') === cur) value += val(c); else other++; }
  return { value, parts: ds.length, other, currency: cur };
}
export const itemLabel = i => (i ? (i.name || [i.make, i.model].filter(Boolean).join(' ') || 'Untitled item') : '');
