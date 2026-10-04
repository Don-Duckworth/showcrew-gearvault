// ShowCrew GearVault v2 — sign-in, mandatory TOTP enrollment, TOTP challenge (aal2), password reset. HUD-styled full-screen card.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const redirectTo = () => location.origin + location.pathname;
const msg = e => (e && (e.message || e.error_description)) || String(e || 'Something went wrong');

function card(root, title, body, foot = '') {
  root.innerHTML = `<div class="auth-card pane">
    <div class="auth-brand"><svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><path d="M24 15v-4h16v4" fill="none" stroke="#00e5ff" stroke-width="3"/><rect x="6" y="15" width="52" height="38" rx="4" fill="none" stroke="#00e5ff" stroke-width="3"/><path d="M6 27h52" stroke="#00e5ff" stroke-width="1.6" opacity=".7"/><rect x="14" y="23" width="8" height="8" rx="1.5" fill="#05080f" stroke="#00e5ff" stroke-width="2.2"/><rect x="42" y="23" width="8" height="8" rx="1.5" fill="#05080f" stroke="#00e5ff" stroke-width="2.2"/><rect x="34" y="36" width="17" height="11" rx="2" fill="none" stroke="#ff3df2" stroke-width="2.4"/></svg>
      <div><div class="brand-sub">SHOWCREW TOOLS</div><div class="brand-main">GEAR<span>VAULT</span></div></div></div>
    <div class="lbl auth-title">${title}</div>
    <form class="col" novalidate>${body}<p class="auth-err warn" role="alert" hidden></p></form>
    ${foot ? `<div class="auth-foot">${foot}</div>` : ''}</div>`;
  root.hidden = false;
  const f = $('form', root);
  setTimeout(() => $('input:not([type=hidden])', root)?.focus({ preventScroll: true }), 30);
  return f;
}
function busy(form, on, label) {
  const b = $('button[type=submit]', form); if (!b) return;
  if (on) { b.dataset.l = b.textContent; b.textContent = label || 'Working…'; b.disabled = true; } else { b.textContent = b.dataset.l || b.textContent; b.disabled = false; }
}
function err(form, e) { const p = $('.auth-err', form); p.textContent = e ? msg(e) : ''; p.hidden = !e; }
const codeInput = (id = 'code') => `<label class="fld"><span>6-digit code from your authenticator app</span><input class="inp code" id="${id}" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="••••••" required></label>`;

export function showSetup(root) {
  card(root, 'CLOUD NOT CONFIGURED', `<p class="hint">Fill in <b>js/config.js</b> with your Supabase project URL and anon (publishable) key, then reload. See README → “Supabase setup”.</p>`);
}
export function showOfflineNoSession(root) {
  card(root, 'OFFLINE', `<p class="hint">You're offline and this browser has no saved copy of your gear yet. Connect to the internet and sign in once — after that GearVault opens read-only when offline.</p>
    <button type="button" class="btn primary" onclick="location.reload()">Retry</button>`);
}

/**
 * Resolve with { user } once the session is at aal2. Never resolves while the user is at aal1 / signed out.
 * opts: { allowSignup, recovery }
 */
export function ensureAal2(sb, root, opts = {}) {
  let recovery = !!opts.recovery;
  return new Promise(resolve => {
    sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') { recovery = true; next(); } });

    async function next() {
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return signIn();
        const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) throw error;
        if (aal.currentLevel === 'aal2') return recovery ? newPassword(session.user) : done(session.user);
        if (aal.nextLevel === 'aal2') return challenge(session.user);
        return enroll(session.user);
      } catch (e) { signIn(e); }
    }
    function done(user) { root.hidden = true; root.innerHTML = ''; resolve({ user }); }

    function signIn(e0) {
      const f = card(root, 'SIGN IN', `
        <label class="fld"><span>Email</span><input class="inp" id="email" type="email" autocomplete="username" required></label>
        <label class="fld"><span>Password</span><input class="inp" id="pw" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Sign in</button>`,
        `<button class="linkish" type="button" data-go="forgot">Forgot password?</button>${opts.allowSignup ? '<button class="linkish" type="button" data-go="signup">Create account</button>' : ''}`);
      if (e0) err(f, e0);
      f.onsubmit = async ev => {
        ev.preventDefault(); err(f); busy(f, true, 'Signing in…');
        const { error } = await sb.auth.signInWithPassword({ email: $('#email', f).value.trim(), password: $('#pw', f).value });
        busy(f, false); if (error) return err(f, error); next();
      };
      wire();
    }
    function signUp() {
      const f = card(root, 'CREATE ACCOUNT', `
        <label class="fld"><span>Email</span><input class="inp" id="email" type="email" autocomplete="username" required></label>
        <label class="fld"><span>Password (12+ characters)</span><input class="inp" id="pw" type="password" autocomplete="new-password" minlength="12" required></label>
        <button class="btn primary" type="submit">Create account</button>`, '<button class="linkish" type="button" data-go="signin">← Back to sign in</button>');
      f.onsubmit = async ev => {
        ev.preventDefault(); err(f);
        const pw = $('#pw', f).value; if (pw.length < 12) return err(f, 'Use at least 12 characters.');
        busy(f, true);
        const { data, error } = await sb.auth.signUp({ email: $('#email', f).value.trim(), password: pw, options: { emailRedirectTo: redirectTo() } });
        busy(f, false); if (error) return err(f, error);
        if (data.session) return next();
        card(root, 'CHECK YOUR EMAIL', '<p class="hint">Confirm your address with the link we sent, then sign in. You\'ll set up two-factor authentication next.</p>', '<button class="linkish" type="button" data-go="signin">← Back to sign in</button>'); wire();
      };
      wire();
    }
    function forgot() {
      const f = card(root, 'RESET PASSWORD', `<label class="fld"><span>Email</span><input class="inp" id="email" type="email" autocomplete="username" required></label>
        <button class="btn primary" type="submit">Email me a reset link</button>`, '<button class="linkish" type="button" data-go="signin">← Back to sign in</button>');
      f.onsubmit = async ev => {
        ev.preventDefault(); err(f); busy(f, true);
        const { error } = await sb.auth.resetPasswordForEmail($('#email', f).value.trim(), { redirectTo: redirectTo() });
        busy(f, false); if (error) return err(f, error);
        card(root, 'CHECK YOUR EMAIL', '<p class="hint">If that address has an account, a reset link is on its way. Open it on this device; you\'ll enter your authenticator code, then choose a new password.</p>', '<button class="linkish" type="button" data-go="signin">← Back to sign in</button>'); wire();
      };
      wire();
    }
    async function enroll(user) {
      const f0 = card(root, 'SET UP TWO-FACTOR (REQUIRED)', '<p class="hint">Preparing…</p>'); err(f0);
      try {
        // Drop half-finished enrollments so a fresh QR code can be issued.
        const { data: list } = await sb.auth.mfa.listFactors();
        for (const fct of (list?.all || []).filter(x => x.factor_type === 'totp' && x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: fct.id });
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `GearVault ${new Date().toISOString().slice(0, 16)}`, issuer: 'ShowCrew GearVault' });
        if (error) throw error;
        const f = card(root, 'SET UP TWO-FACTOR (REQUIRED)', `
          <p class="hint">Signed in as <b>${esc(user.email)}</b>. Scan this with an authenticator app (1Password, Authy, Google Authenticator, iOS Passwords…), then enter the 6-digit code. GearVault won't show any data until this is done.</p>
          <div class="qr"><img id="qr" alt="TOTP QR code" src="${esc(data.totp.qr_code)}"></div>
          <label class="fld"><span>Or enter this secret manually</span><input class="inp mono-sm" id="secret" readonly value="${esc(data.totp.secret)}"></label>
          ${codeInput()}
          <button class="btn primary" type="submit">Verify &amp; turn on 2FA</button>`, '<button class="linkish" type="button" data-go="signout">Sign out</button>');
        $('#secret', f).onfocus = e => e.target.select();
        f.onsubmit = async ev => {
          ev.preventDefault(); err(f); busy(f, true, 'Verifying…');
          const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: $('#code', f).value.trim() });
          busy(f, false); if (e2) return err(f, e2); next();
        };
        wire();
      } catch (e) { err(f0, e); wire(); }
    }
    async function challenge(user) {
      const { data: list, error } = await sb.auth.mfa.listFactors();
      const factors = (list?.totp || []).filter(x => x.status === 'verified');
      if (error || !factors.length) return signIn(error || 'No verified authenticator found.');
      const f = card(root, 'TWO-FACTOR CHECK', `
        <p class="hint">Signed in as <b>${esc(user.email)}</b>. Enter the current code from your authenticator app.</p>
        ${factors.length > 1 ? `<label class="fld"><span>Authenticator</span><select class="inp" id="factor">${factors.map(x => `<option value="${esc(x.id)}">${esc(x.friendly_name || 'Authenticator')}</option>`).join('')}</select></label>` : ''}
        ${codeInput()}
        <button class="btn primary" type="submit">Verify</button>`, '<button class="linkish" type="button" data-go="signout">Sign out / use another account</button>');
      f.onsubmit = async ev => {
        ev.preventDefault(); err(f); busy(f, true, 'Verifying…');
        const factorId = $('#factor', f)?.value || factors[0].id;
        const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
        if (e1) { busy(f, false); return err(f, e1); }
        const { error: e2 } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: $('#code', f).value.trim() });
        busy(f, false); if (e2) { $('#code', f).value = ''; return err(f, e2); }
        next();
      };
      wire();
    }
    function newPassword(user) {
      const f = card(root, 'CHOOSE A NEW PASSWORD', `
        <p class="hint">For <b>${esc(user.email)}</b>.</p>
        <label class="fld"><span>New password (12+ characters)</span><input class="inp" id="pw" type="password" autocomplete="new-password" minlength="12" required></label>
        <label class="fld"><span>Repeat</span><input class="inp" id="pw2" type="password" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Save password</button>`);
      f.onsubmit = async ev => {
        ev.preventDefault(); err(f);
        const pw = $('#pw', f).value; if (pw.length < 12) return err(f, 'Use at least 12 characters.'); if (pw !== $('#pw2', f).value) return err(f, 'Passwords don\'t match.');
        busy(f, true); const { error } = await sb.auth.updateUser({ password: pw }); busy(f, false);
        if (error) return err(f, error);
        recovery = false; history.replaceState(null, '', location.pathname); next();
      };
    }
    function wire() {
      root.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => {
        const g = b.dataset.go;
        if (g === 'signin') signIn(); else if (g === 'signup') signUp(); else if (g === 'forgot') forgot();
        else if (g === 'signout') { await sb.auth.signOut(); signIn(); }
      });
    }
    next();
  });
}
