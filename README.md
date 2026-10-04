# ShowCrew GearVault — ShowCrew Tools (v2 · Supabase cloud)

Track computer / show gear (Millumin, PowerPoint & Keynote rigs, rack PCs, audio, network, cables, cases) with photos and receipts,
group it into kits / road cases, and build the **ATA Carnet General List** for travel abroad.
Plain HTML/CSS/JS PWA, no build step. **v2 keeps your data in your own Supabase project** (Postgres + private Storage), so it is the
same on every device and browser, behind **email + password + an authenticator code (TOTP 2FA)**.

Live: https://don-duckworth.github.io/showcrew-gearvault/ (GitHub Pages, `main` /). Run locally: `python3 -m http.server 8766` → http://localhost:8766

---

## Status of Don's project

Project **ShowCrew GearVault** (ref `ggtkglxvuxvmuqtpvlgs`, us-east-2). Steps 1, 2 and 7 below are **done**: the schema is applied
(migrations `init_gearvault` + `init_gearvault_advisor_fixes`) and `js/config.js` holds the project URL and the `sb_publishable_…` key.
Still to do in the dashboard (steps 3–6):

- URL configuration (Site URL + Redirect URLs): https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/url-configuration
- MFA (check TOTP is enabled): https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/mfa
- Add your user (Auto Confirm): https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/users
- Turn off "Allow new users to sign up": https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/providers
- Optional custom SMTP: https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/smtp

## One-time Supabase setup (≈10 minutes)

1. **Create the project** — https://supabase.com/dashboard → *New project* (any name, e.g. `gearvault`; pick a region near you; save the DB password somewhere safe).
2. **Create the tables, security rules and file bucket** — Dashboard → *SQL Editor* → *New query* → paste all of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → *Run*. It's safe to run again.
   It creates the tables, Row Level Security, and the private Storage bucket **`gear-files`** (no need to create the bucket by hand).
3. **Point auth at the app** — *Authentication → URL Configuration*:
   - **Site URL**: `https://don-duckworth.github.io/showcrew-gearvault/`
   - **Redirect URLs**: add `https://don-duckworth.github.io/showcrew-gearvault/` (and `http://localhost:8766/` if you test locally).
   These are where password-reset (and sign-up confirmation) emails send you back to.
4. **Check TOTP MFA is on** — *Authentication → Multi-Factor* (sometimes under *Sign In / Providers*): **TOTP (App Authenticator)** must be *Enabled*
   (it is by default). Phone/SMS MFA isn't used.
5. **Create your account** — *Authentication → Users → Add user → Create new user*: your email + a strong password, tick **Auto Confirm User**.
   (Alternative: set `ALLOW_SIGNUP = true` in `js/config.js`, sign up in the app, confirm the email, then set it back to `false`.)
6. **Turn off public sign-ups** — *Authentication → Sign In / Providers* (*Settings* on older dashboards): switch **off "Allow new users to sign up"**.
   The app hides the sign-up form by default (`ALLOW_SIGNUP = false`), but only this dashboard switch actually stops strangers creating accounts on your project.
   (Even if someone did, Row Level Security means they could never see your rows or files.)
7. **Fill in `js/config.js`** — *Project Settings → API* (or the *Connect* button / *API Keys*):
   ```js
   export const SUPABASE_URL = 'https://<your-project-ref>.supabase.co';   // Project URL
   export const SUPABASE_ANON_KEY = '<anon public key  or  sb_publishable_… key>';
   ```
   The anon / publishable key is **meant to be public** (it ships to every browser); security comes from RLS + 2FA.
   **Never** put the `service_role` / `sb_secret_…` key in this file.
   Commit + push; GitHub Pages redeploys in a minute.
8. **First sign-in** — open the app, sign in, and it makes you **set up 2FA**: scan the QR code (or type the secret) into 1Password / Authy /
   Google Authenticator / iOS Passwords, enter the 6-digit code. **Save the secret somewhere safe** (or scan it into two apps) — there are no
   backup codes; if you lose the authenticator you'd have to remove the factor in *Authentication → Users → (you) → MFA factors* in the dashboard.
   From then on every sign-in asks for the 6-digit code.
9. If this browser still has your **v1 on-device gear**, the app offers **"Upload my on-device gear to the cloud"** (items, kits, trips, photos/receipts).
   The local copy is kept until you delete it in *Data → On-device gear (v1) → Delete on-device copy*. Uploading twice does not duplicate anything.

Optional: *Authentication → Emails → SMTP* with your own mail provider — Supabase's built-in email sender is heavily rate-limited (a few emails per hour),
which only matters for password resets. Free-plan projects pause after a week of no use; open the dashboard and *Restore* if that happens.

---

## How it works

- **Security model**
  - Every table has Row Level Security: a row is visible/changeable only by its owner (`owner_id = auth.uid()`, filled in automatically), **and** a
    *restrictive* policy requires the session to be MFA-verified (`auth.jwt()->>'aal' = 'aal2'`). A password-only session can't read or write anything.
  - Photos/receipts live in the **private** bucket `gear-files` under `<your user id>/<item id>/<file id>`; Storage policies allow only your own folder, with aal2.
    The app shows them via short-lived (10 min) signed URLs.
  - The `anon` role has no table privileges at all. Relations (kit ↔ item, trip ↔ kit/item) use composite `(owner_id, id)` foreign keys, so rows can't point at another user's data.
  - Password reset: the email link signs you in, the app then asks for your 6-digit code, and only then lets you set the new password.
- **Data model** (`supabase/migrations/0001_init.sql`): `settings`, `categories`, `items`, `attachments` (file metadata), `kits`, `kit_items`,
  `trips`, `trip_kits`, `trip_items` (`mode` = include / exclude). All have `owner_id`, `created_at`, `updated_at` (trigger).
- **Saving**: edits apply instantly on screen and are saved to Supabase in the background (only the rows that changed). The badge next to the logo shows
  **CLOUD · SYNCED / SAVING / NOT SAVED · RETRYING / OFFLINE · READ-ONLY**. If a save fails (e.g. Wi-Fi drop) it retries automatically; closing the tab with
  unsaved changes warns you. If two devices edit the same item, the last save wins. Data reloads when you come back to the tab (no realtime).
- **Offline**: the last synced data (and photos you've viewed) are cached in this browser (IndexedDB `showcrew-gearvault-cloud`), so the app opens
  **read-only** without a connection — handy for checking the carnet list at the border. Edits need a connection. Signing out deletes this cache.
- **Backup**: *Data → Export backup* downloads one JSON file with all gear, kits, trips, settings and every photo/receipt (base64) from the cloud;
  *Restore backup* merges into or replaces your cloud data. v1 backup files restore fine. Inventory CSV export/import and the template still work.
- **Gear / Kits / Trips / Carnet**: unchanged from v1 — fields, kits, trip picking with per-trip exclusions, flags for missing serial/value/origin,
  General List print/PDF (US Letter landscape) and Excel-friendly CSV.
- **Supabase client**: `js/vendor/supabase.js` is the vendored supabase-js 2.117.2 UMD build (MIT, see `supabase-js.LICENSE`) — no CDN.
- **Service worker** caches only the app's own files (`config.js` network-first); it never touches Supabase API/storage requests.
  **Bump `VERSION` in `sw.js` whenever you change files** so installed copies refresh.

## Tests

- `node tools/test-carnet.mjs` — carnet/CSV logic + cloud row mapping (round-trip, diff, deterministic v1→UUID ids).
- `GV_URL=http://127.0.0.1:8766/ node tools/browser-test.mjs` — headless desktop / iPad / iPhone run (needs playwright and a local server).
  Uses an in-browser **fake Supabase client** (`tools/fake-supabase.js`, injected through `window.__GV_TEST_SUPABASE__`) that simulates auth, TOTP
  (code `246810`), owner-only + aal2 RLS and storage — no real project needed. Writes `screenshots/`.
- `tools/test-sql.sh` — runs the migration twice (idempotency) against a local Postgres with small Supabase stubs (`supabase/tests/local-stub.sql`)
  and then `supabase/tests/rls-test.sql` (25 checks: aal1 gets nothing, cross-user isolation, forged owner_id, foreign folders in storage, cross-owner links, anon…).
- Icons: `node tools/make-icons.mjs` (needs playwright).
