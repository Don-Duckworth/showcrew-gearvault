// In-browser fake of the parts of supabase-js v2 GearVault uses — for headless UI tests only (never deployed / cached).
// Injected with page.addInitScript; installs window.__GV_TEST_SUPABASE__ (the app's test hook) and window.__fakeSb (inspection).
// Mimics: owner-only RLS, the aal2 requirement on all data + storage, composite-FK checks + cascades, TOTP enroll/challenge.
(() => {
  const OPTS = window.__FAKE_SB_OPTS || {};
  const DBKEY = '__fakesb_db', SESSKEY = '__fakesb_session', OBJ = '__fakesb_obj:';
  const VALID_CODE = OPTS.code || '246810';
  const uuid = () => crypto.randomUUID();
  const load = () => JSON.parse(localStorage.getItem(DBKEY) || 'null');
  const save = db => localStorage.setItem(DBKEY, JSON.stringify(db));
  let db = load();
  if (!db) {
    db = { users: OPTS.users || [{ id: '0d0d0d0d-1111-4222-8333-444455556666', email: 'don@example.com', password: 'correct horse battery', factors: [] }], tables: {} };
    save(db);
  }
  const T = ['settings', 'categories', 'items', 'kits', 'trips', 'attachments', 'kit_items', 'trip_kits', 'trip_items'];
  for (const t of T) db.tables[t] = db.tables[t] || [];
  const log = []; let failNext = 0; const listeners = [];
  const sess = () => JSON.parse(localStorage.getItem(SESSKEY) || 'null');
  const setSess = s => { if (s) localStorage.setItem(SESSKEY, JSON.stringify(s)); else localStorage.removeItem(SESSKEY); };
  const userOf = s => s && db.users.find(u => u.id === s.user_id);
  const pubUser = u => ({ id: u.id, email: u.email, factors: u.factors.filter(f => f.status === 'verified') });
  const session = () => { const s = sess(), u = userOf(s); return u ? { access_token: 'fake.' + s.aal, user: pubUser(u), aal: s.aal } : null; };
  const emit = (ev, s) => listeners.forEach(cb => setTimeout(() => cb(ev, s), 0));
  const net = () => (navigator.onLine ? null : { message: 'Failed to fetch', name: 'AuthRetryableFetchError' });
  const rls = () => { const s = sess(); return s && s.aal === 'aal2' ? s.user_id : null; };
  const err = (message, code) => ({ message, code });
  const KEY = { settings: ['owner_id'], categories: ['owner_id', 'name'], items: ['id'], kits: ['id'], trips: ['id'], attachments: ['id'], kit_items: ['kit_id', 'item_id'], trip_kits: ['trip_id', 'kit_id'], trip_items: ['trip_id', 'item_id'] };
  const FK = { attachments: [['item_id', 'items']], kit_items: [['kit_id', 'kits'], ['item_id', 'items']], trip_kits: [['trip_id', 'trips'], ['kit_id', 'kits']], trip_items: [['trip_id', 'trips'], ['item_id', 'items']] };
  const kv = (t, r, cols) => cols.map(c => r[c]).join('|');
  function cascade(table, ids) {
    for (const [child, fks] of Object.entries(FK)) for (const [col, parent] of fks) if (parent === table) db.tables[child] = db.tables[child].filter(r => !ids.has(r[col]));
  }

  class Query {
    constructor(table) { this.t = table; this.op = 'select'; this.filters = []; this.rng = null; }
    select() { this.op = this.op === 'select' ? 'select' : this.op; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    in(c, vs) { const s = new Set(vs); this.filters.push(r => s.has(r[c])); return this; }
    upsert(rows, o = {}) { this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.conflict = (o.onConflict || 'id').split(','); return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    run() {
      log.push({ op: this.op, t: this.t, n: this.rows?.length, aal: sess()?.aal || null });
      const e = net(); if (e) return { data: null, error: e };
      if (failNext > 0 && this.op !== 'select') { failNext--; return { data: null, error: err('Simulated network error', 'FAKE') }; }
      const uid = rls(), tbl = db.tables[this.t];
      if (this.op === 'select') {
        let rows = uid ? tbl.filter(r => r.owner_id === uid) : [];
        rows = rows.filter(r => this.filters.every(f => f(r)));
        if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
        return { data: JSON.parse(JSON.stringify(rows)), error: null };
      }
      if (!uid) return { data: null, error: err('new row violates row-level security policy', '42501') };
      if (this.op === 'upsert') {
        const now = new Date().toISOString();
        for (const r0 of this.rows) {
          const r = { ...r0 };
          if (r.owner_id && r.owner_id !== uid) return { data: null, error: err('new row violates row-level security policy', '42501') };
          r.owner_id = uid;
          for (const [col, parent] of FK[this.t] || []) if (!db.tables[parent].some(p => p.id === r[col] && p.owner_id === uid)) return { data: null, error: err(`insert or update on table "${this.t}" violates foreign key constraint (${col})`, '23503') };
          if (this.t === 'attachments' && r.path.split('/')[0] !== uid) return { data: null, error: err('check constraint violated (path)', '23514') };
          const k = kv(this.t, r, this.conflict), ix = tbl.findIndex(x => kv(this.t, x, this.conflict) === k);
          if (ix >= 0) { if (tbl[ix].owner_id !== uid) return { data: null, error: err('new row violates row-level security policy', '42501') }; tbl[ix] = { ...tbl[ix], ...r, updated_at: now }; }
          else tbl.push({ created_at: now, updated_at: now, ...r });
        }
        save(db); return { data: null, error: null };
      }
      if (this.op === 'delete') {
        const del = tbl.filter(r => r.owner_id === uid && this.filters.every(f => f(r)));
        const ids = new Set(del.map(r => r.id).filter(Boolean));
        db.tables[this.t] = tbl.filter(r => !del.includes(r));
        cascade(this.t, ids); save(db); return { data: null, error: null };
      }
    }
  }

  const toDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  const fromDataURL = u => fetch(u).then(r => r.blob());
  const objKeys = () => Object.keys(localStorage).filter(k => k.startsWith(OBJ));
  const storageGate = path => { const e = net(); if (e) return e; const uid = rls(); if (!uid) return err('new row violates row-level security policy', '42501'); if (path.split('/')[0] !== uid) return err('Unauthorized (path outside your folder)', '42501'); return null; };
  function bucket(name) {
    return {
      async upload(path, blob, o = {}) {
        log.push({ op: 'upload', path, aal: sess()?.aal }); const e = storageGate(path); if (e) return { data: null, error: e };
        if (failNext > 0) { failNext--; return { data: null, error: err('Simulated network error') }; }
        if (localStorage.getItem(OBJ + path) && !o.upsert) return { data: null, error: err('The resource already exists') };
        localStorage.setItem(OBJ + path, JSON.stringify({ type: o.contentType || blob.type, data: await toDataURL(blob) }));
        return { data: { path }, error: null };
      },
      async download(path) {
        log.push({ op: 'download', path, aal: sess()?.aal }); const e = storageGate(path); if (e) return { data: null, error: e };
        const o = JSON.parse(localStorage.getItem(OBJ + path) || 'null'); if (!o) return { data: null, error: err('Object not found') };
        return { data: await fromDataURL(o.data), error: null };
      },
      async remove(paths) {
        for (const p of paths) { const e = storageGate(p); if (e) return { data: null, error: e }; }
        paths.forEach(p => localStorage.removeItem(OBJ + p)); log.push({ op: 'remove', paths }); return { data: [], error: null };
      },
      async createSignedUrl(path, exp, o = {}) {
        log.push({ op: 'sign', path, exp, download: o.download || null }); const e = storageGate(path); if (e) return { data: null, error: e };
        const ob = JSON.parse(localStorage.getItem(OBJ + path) || 'null'); if (!ob) return { data: null, error: err('Object not found') };
        return { data: { signedUrl: URL.createObjectURL(await fromDataURL(ob.data)) }, error: null };
      },
    };
  }

  const ok = data => ({ data, error: null });
  const auth = {
    async getSession() { return ok({ session: session() }); },
    async getUser() { const s = session(); return s ? ok({ user: s.user }) : { data: { user: null }, error: err('not signed in') }; },
    onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() { } } } }; },
    async signInWithPassword({ email, password }) {
      log.push({ op: 'signIn', email }); const e = net(); if (e) return { data: null, error: e };
      const u = db.users.find(x => x.email === email && x.password === password);
      if (!u) return { data: { user: null, session: null }, error: err('Invalid login credentials') };
      setSess({ user_id: u.id, aal: 'aal1' }); emit('SIGNED_IN', session()); return ok({ user: pubUser(u), session: session() });
    },
    async signUp({ email, password }) {
      log.push({ op: 'signUp', email }); if (db.users.some(u => u.email === email)) return ok({ user: null, session: null });
      db.users.push({ id: uuid(), email, password, factors: [] }); save(db); return ok({ user: { email }, session: null });
    },
    async signOut() { log.push({ op: 'signOut' }); setSess(null); emit('SIGNED_OUT', null); return { error: null }; },
    async resetPasswordForEmail(email, o) { log.push({ op: 'reset', email, redirectTo: o?.redirectTo }); return ok({}); },
    async updateUser({ password }) {
      const s = sess(), u = userOf(s); if (!u) return { data: null, error: err('not signed in') };
      if (u.factors.some(f => f.status === 'verified') && s.aal !== 'aal2') return { data: null, error: err('AAL2 session is required to update this user') };
      u.password = password; save(db); log.push({ op: 'updateUser' }); return ok({ user: pubUser(u) });
    },
    mfa: {
      async listFactors() { const u = userOf(sess()); if (!u) return { data: null, error: err('not signed in') }; return ok({ all: u.factors.map(f => ({ ...f })), totp: u.factors.filter(f => f.status === 'verified').map(f => ({ ...f })) }); },
      async enroll({ factorType, friendlyName }) {
        const u = userOf(sess()); if (!u) return { data: null, error: err('not signed in') };
        const f = { id: uuid(), factor_type: factorType, friendly_name: friendlyName, status: 'unverified' }; u.factors.push(f); save(db); log.push({ op: 'enroll' });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/>${Array.from({ length: 160 }, (_, i) => `<rect x="${(i * 7) % 29}" y="${(i * 11) % 29}" width="1" height="1"/>`).join('')}<rect x="1" y="1" width="7" height="7" fill="none" stroke="#000"/><rect x="21" y="1" width="7" height="7" fill="none" stroke="#000"/><rect x="1" y="21" width="7" height="7" fill="none" stroke="#000"/></svg>`;
        return ok({ id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,' + encodeURIComponent(svg), secret: 'JBSWY3DPEHPK3PXPFAKE', uri: 'otpauth://totp/GearVault:' + u.email } });
      },
      async unenroll({ factorId }) { const u = userOf(sess()); u.factors = u.factors.filter(f => f.id !== factorId); save(db); log.push({ op: 'unenroll' }); return ok({ id: factorId }); },
      async challenge({ factorId }) { log.push({ op: 'challenge' }); return ok({ id: 'ch_' + factorId }); },
      async verify({ factorId, code }) {
        log.push({ op: 'verify', code }); const s = sess(), u = userOf(s), f = u && u.factors.find(x => x.id === factorId);
        if (!f) return { data: null, error: err('Factor not found') };
        if (code !== VALID_CODE) return { data: null, error: err('Invalid TOTP code entered') };
        f.status = 'verified'; save(db); setSess({ ...s, aal: 'aal2' }); emit('MFA_CHALLENGE_VERIFIED', session()); return ok({ access_token: 'fake.aal2' });
      },
      async challengeAndVerify({ factorId, code }) { await this.challenge({ factorId }); return this.verify({ factorId, code }); },
      async getAuthenticatorAssuranceLevel() {
        const s = sess(), u = userOf(s); if (!u) return ok({ currentLevel: null, nextLevel: null });
        return ok({ currentLevel: s.aal, nextLevel: u.factors.some(f => f.status === 'verified') ? 'aal2' : 'aal1' });
      },
    },
  };
  // Simulate opening a password-recovery link (#...type=recovery): recovery sessions start at aal1.
  if (/type=recovery/.test(location.hash) && OPTS.recoveryEmail) {
    const u = db.users.find(x => x.email === OPTS.recoveryEmail);
    if (u) { setSess({ user_id: u.id, aal: 'aal1' }); setTimeout(() => emit('PASSWORD_RECOVERY', session()), 30); }
  }
  const client = { auth, from: t => new Query(t), storage: { from: bucket } };
  window.__GV_TEST_SUPABASE__ = cfg => { log.push({ op: 'createClient', bucket: cfg.STORAGE_BUCKET }); return client; };
  window.__fakeSb = {
    log, get db() { return db; }, reload() { db = load(); for (const t of T) db.tables[t] = db.tables[t] || []; },
    objects: () => objKeys().map(k => k.slice(OBJ.length)), set failNext(n) { failNext = n; }, code: VALID_CODE,
    // "another device" writes straight into the database
    insert(table, row) { db.tables[table].push({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row }); save(db); },
  };
})();
