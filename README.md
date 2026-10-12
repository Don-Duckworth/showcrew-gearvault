# ShowCrew GearVault — ShowCrew Tools (v2.4 · Supabase cloud)

Track computer / show gear (Millumin, PowerPoint & Keynote rigs, rack PCs, audio, network, cables, cases) with photos and receipts,
group it into kits / road cases, and build the **ATA Carnet General List** for travel abroad.
Plain HTML/CSS/JS PWA, no build step. **v2 keeps your data in your own Supabase project** (Postgres + private Storage), so it is the
same on every device and browser, behind **email + password + an authenticator code (TOTP 2FA)**.

Live: https://don-duckworth.github.io/showcrew-gearvault/ (GitHub Pages, `main` /). Run locally: `python3 -m http.server 8766` → http://localhost:8766

---

## Status of Don's project

Project **ShowCrew GearVault** (ref `ggtkglxvuxvmuqtpvlgs`, us-east-2). Steps 1, 2 and 7 below are **done**: the schema is applied
(migrations `init_gearvault` + `init_gearvault_advisor_fixes`, for v2.1 `electromaxx_no` + `electromaxx_trip_toggle` = `0002_electromaxx.sql`, for v2.2 `parts_parent_child` = `0003_parts.sql`, for v2.3 `fmv_columns` + `fmv_sources_both` = `0004_fmv.sql`, and for v2.4 `value_as_of` = `0005_value_date.sql`; the Edge Function `fmv-lookup` is deployed) and `js/config.js` holds the project URL and the `sb_publishable_…` key.
Still to do in the dashboard (steps 3–6):

- URL configuration (Site URL + Redirect URLs): https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/url-configuration
- MFA (check TOTP is enabled): https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/mfa
- Add your user (Auto Confirm): https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/users
- Turn off "Allow new users to sign up": https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/providers
- **Update values (v2.3)** — add the SerpApi key as an Edge Function secret named exactly **`SERPAPI_KEY`**:
  https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/functions/secrets (see *Fair market value* below)
- Optional custom SMTP: https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/auth/smtp

## One-time Supabase setup (≈10 minutes)

1. **Create the project** — https://supabase.com/dashboard → *New project* (any name, e.g. `gearvault`; pick a region near you; save the DB password somewhere safe).
2. **Create the tables, security rules and file bucket** — Dashboard → *SQL Editor* → *New query* → paste all of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → *Run*. It's safe to run again.
   It creates the tables, Row Level Security, and the private Storage bucket **`gear-files`** (no need to create the bucket by hand).
   Then do the same with [`supabase/migrations/0002_electromaxx.sql`](supabase/migrations/0002_electromaxx.sql) (v2.1 Electromaxx gear number) and
   [`supabase/migrations/0003_parts.sql`](supabase/migrations/0003_parts.sql) (v2.2 parts & accessories) — both safe to re-run.
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
- **Electromaxx gear number (v2.1)** — the sticker with a barcode + 6-digit number.
  - *Item editor*: **Electromaxx #** field next to the serial (numeric keypad), must be exactly 6 digits, warns live if another item already has it
    and won't save a duplicate. **Scan** button fills it from the barcode. In the DB: `items.electromaxx_no` (text, `^[0-9]{6}$` check, unique per owner).
    To swap numbers between two items, clear one first (two saves).
  - *Gear list*: amber `#004217` tag on each row, included in search, sort **"Electromaxx #"**, filter **Has / No Electromaxx #**. The **scan button in
    the search bar** jumps straight to the item; an unknown number offers *Add new gear with this #* or *Put it on existing gear…*.
  - *Carnet*: per-trip toggle **"Electromaxx # column"** (off by default — it's an internal asset tag) adds the column to the on-screen list, print/PDF
    and the General List CSV (`trips.show_emx`).
  - *CSV*: inventory export has an **`Electromaxx #`** column; import also accepts `Electromaxx No`, `Electromaxx Number`, `electromaxx_no`, `EMX`,
    `EMX #`, `Asset tag`, `Gear #`, `Barcode`… Excel drops leading zeros (`4217`) — import pads them back to `004217`. Invalid or duplicate numbers are
    skipped (the item is still imported) and counted in the import message. JSON backup/restore and the v1 upload carry the field too.
- **Parts & accessories (v2.2)** — gear can contain gear (`js/parts.js`). In the DB: `items.parent_id` (composite FK `(owner_id, parent_id)` →
  `items(owner_id, id)`, so a part can only belong to *your* item; `on delete set null`), `items.part_type` = `installed` | `accessory`, a trigger that
  rejects cycles (A part of B part of A), and `trips.fold_parts`.
  - *Item editor*: **Contents & accessories** lists the parts (type, Electromaxx #, serial, value, total incl. parts). **＋ Add part** asks *Installed
    inside* or *Separate accessory* and opens a new item prefilled with the parent's category, vendor, purchase date, country (and currency); saving
    returns you to the parent. **⛓ Link existing gear** is a searchable picker (never offers the item itself or anything it is part of). ⛓✕ unlinks.
    A part's editor shows **Part of: <parent>** (tap to open it), its part type and **Unlink**. Adding a part / linking on a brand-new item saves it first.
  - *Deleting a parent* asks: **delete it and its parts**, or **keep the parts as standalone gear** (only its direct parts are unlinked).
  - *Gear list*: parts are nested (indented) under their parent; the magenta **N parts** badge collapses/expands them. With a search or filter the list
    is flat and parts carry a **↳ part of X** tag. Each item is counted once in the totals; a parent also shows its value **incl. parts** (info only).
  - *Scan*: scanning a part's Electromaxx # opens the part and shows its parent.
  - *Kits / trips*: adding a parent brings all its parts (any depth) along; counts include them. Any part line can still be left off one trip (✕),
    and leaving off a parent leaves off the parts that came with it.
  - *Carnet*: an **accessory** is its own numbered line ("accessory to item 1") and counts as pieces. **Installed** parts are sub-lines **1a, 1b…**
    with description, serial, value and origin — no pieces, weight "incl." in the parent, value in the totals. Per-trip switch **Fold installed parts
    into parent line** adds their value to the parent line and appends "— incl. installed: … S/N …" to its description. Missing serial / value / origin
    checks cover parts (installed parts aren't asked for a weight). Print/PDF and CSV follow the same layout.
  - *CSV*: inventory export/import has **Parent Electromaxx #**, **Parent serial**, **Part type** (`installed` / `accessory`; also "Installed inside",
    "Separate accessory"). Import links rows after all rows are in (a part may come before its parent), by Parent Electromaxx #, else Parent serial;
    unknown parents are counted in the message and the item is imported standalone. Empty parent cells don't unlink an existing part.
    JSON backup/restore and the v1 upload carry `parentId` / `partType` / `foldParts`.
- **Barcode scanning** (`js/scan.js`, `js/emx.js`)
  - Uses the browser's native **`BarcodeDetector`** where it exists (Chrome/Edge on Android, ChromeOS, macOS). Otherwise (iPhone/iPad Safari, Firefox,
    desktop Chrome on Windows/Linux) it loads the vendored **ZXing** decoder (`js/vendor/zxing.min.js`, @zxing/library 0.23.0, Apache-2.0 — no CDN;
    precached by the service worker, so it works offline).
  - Formats: Code 128, Code 39, Code 93, Codabar, EAN-13/8, UPC-A/E, ITF, QR, Data Matrix. The 6-digit number is pulled out of whatever the code
    holds (e.g. `EMX-004218`, a URL ending in `004221`, or an EAN/UPC like `0000000042208` → check digit dropped → `004220`). If a code holds several
    different 6-digit numbers you pick one.
  - Camera needs **HTTPS** (GitHub Pages is fine; `http://localhost` also works). Fallbacks in the same window: **Take photo of sticker** (decodes a
    still photo, also rotated) and **type the number**. Torch button appears when the camera supports it.
  - **iPhone/iPad notes**: Safari has no BarcodeDetector, so ZXing decodes on the main thread — hold the sticker 10–20 cm away in good light and give
    it a second; the torch is usually not offered on iOS. A Home Screen install may ask for camera permission again each launch. If you tapped *Don't
    Allow*, re-enable it in *Settings → Apps → Safari → Camera* (or the aA menu → Website Settings). *Take photo* is the reliable fallback.
- **Supabase client**: `js/vendor/supabase.js` is the vendored supabase-js 2.117.2 UMD build (MIT, see `supabase-js.LICENSE`) — no CDN.
- **Service worker** caches only the app's own files (`config.js` network-first); it never touches Supabase API/storage/functions requests.
  **Bump `VERSION` in `sw.js` whenever you change files** so installed copies refresh.

## Fair market value — *Update values* (v2.3)

*Gear → ⟳ Update values* (or *Look up value* in an item's editor) estimates each item's current value from **three SerpApi sources with one key**: **Google AI** (default — `engine=google_ai_mode`, question “What is the fair market value of a used *make model name* in USD?”; dollar figure parsed from the answer, a range → its midpoint with low/high kept, the quoted sentence and reference links shown; falls back to the regular Google **AI Overview** (`engine=google`) when AI Mode returns no text), **eBay sold listings** (`engine=ebay`, `_nkw`, `LH_Sold=1`, `LH_Complete=1`) and **Google Shopping** (`engine=google_shopping`, `gl=us`).

1. Make a free account at https://serpapi.com and copy your **API key** (Dashboard → *Api Key*).
2. Supabase → **Edge Functions → Secrets**: https://supabase.com/dashboard/project/ggtkglxvuxvmuqtpvlgs/functions/secrets →
   *Add new secret*: Name **`SERPAPI_KEY`**, Value = your SerpApi key → *Save*. No redeploy needed. (CLI: `supabase secrets set SERPAPI_KEY=…`.)
   Never put the key in `js/config.js` or the repo — only the Edge Function can read it, and it never returns it.
3. In the app: choose scope (all gear / current filter / items without a current value; installed parts and sold/retired gear are skipped unless you tick
   them) and sources (default **Google AI only**; eBay and Shopping optional), *Look up values*, then **review**: per source the median, range, number of prices and up to 5 links. The
   **suggested** value is Google AI when its answer contains a dollar figure, else the eBay sold median when it has ≥ 3 prices after outlier removal, else the Google Shopping median. Pick either source or type your
   own value, edit a row's search text and ↻ retry, untick anything you don't want, *Apply selected*. Only then is `current_value` set (median rounded to whole dollars) and the lookup stored in
   `fmv_value / fmv_low / fmv_high / fmv_count / fmv_checked_at / fmv_query`, with `fmv_sources` = `{pick, links, ebay_sold:{median,low,high,count,sources}, google_new:{…}}`. Items show *value checked &lt;date&gt;*.

Notes:
- **Quota**: 1 SerpApi search per item **per source** (Google AI alone = 1, or 2 when it falls back to the AI Overview; all three ≈ 3); the free plan is about **100 searches / month**. Lookups stop early if the quota or key fails.
- **eBay sold caveat**: since Sep 2026 SerpApi lists its eBay *Sold/Complete* filters as deprecated (eBay put sold results behind a login). The
  function only counts results that carry a sold marker; if none do it shows *Sold listings unavailable* and the Google value is suggested — the eBay
  search is still billed, so untick eBay if that keeps happening.
- **Accuracy**: Google Shopping mostly lists **new retail** prices, so used gear can be overstated — edit the value. Prices are USD (`gl=us`);
  items kept in another currency can't be auto-applied.
- **How the number is made** (`js/fmv.js`, shared with the function): prices from `shopping_results` / eBay `organic_results` (sponsored skipped), outliers removed with a 1.5×IQR fence
  (when ≥ 4 prices), median of the rest. The search text is make + model + name — never serials, Electromaxx numbers or "SAMPLE".
- **Security**: `supabase/functions/fmv-lookup` is deployed with `verify_jwt = true` and additionally refuses sessions that aren't MFA-verified
  (`aal2`). It touches no database rows; the app saves what you apply. The button is disabled offline and the service worker never caches `/functions/v1/`.
- Redeploy after editing: copy `js/fmv.js` into `supabase/functions/fmv-lookup/` (the unit test checks they match), then `supabase functions deploy fmv-lookup`.

## Value as of (v2.4)

Every item has a **Value as of** date (`items.value_as_of`, backfilled from `fmv_checked_at`). It is set to today when *Apply selected* / *Look up value*
sets a value or when you type a current value — and stays editable. The current-value field and the value on each list row are outlined **green**
(“✓ valued 2026-10-12 · 3 mo ago”) when the date is within 365 days and **red** (“⚠ value >1 yr old” / “no fair value date”) otherwise. Since v2.4.1 only *Value as of* counts — there is no
purchase-date fallback; any item without it is red, counts in the stale filter and appears in the trip warning (parts included). Trips show a red banner listing every stale line (incl. installed parts) with *Update values* for just
those items and a *Fix* link each; print / CSV export ask first. Gear filter: *Value >1 yr old / no date*. Inventory CSV and backups carry *Value as of*.

## Tests

- `node tools/test-carnet.mjs` — carnet/CSV logic + cloud row mapping (round-trip, diff, deterministic v1→UUID ids), and v2.2 parts: tree helpers,
  cycle/dangling cleanup, sub-line numbering, pieces/value/weight totals, fold, exclusions, CSV parent columns, parents-first upsert order.
- `GV_URL=http://127.0.0.1:8766/ node tools/browser-test.mjs` — headless desktop / iPad / iPhone run (needs playwright and a local server).
  Uses an in-browser **fake Supabase client** (`tools/fake-supabase.js`, injected through `window.__GV_TEST_SUPABASE__`) that simulates auth, TOTP
  (code `246810`), owner-only + aal2 RLS and storage — no real project needed. Writes `screenshots/`.
- Browser test section *1b* covers the Electromaxx field: validation/duplicates, CSV aliases, carnet toggle, decoding every barcode fixture from a
  photo, a **live scan through Chromium's fake camera** (a y4m video built from `tools/fixtures/camera-004222.png`) with ZXing, and a mocked native
  `BarcodeDetector`. Fixtures are made with `tools/make-barcodes.py` (needs `python-barcode`, `qrcode`, `pillow`).
- Browser test section *1c* covers parts: add part (prefill), link picker (excludes self/ancestors), Part of / unlink, nested list + totals,
  collapse, search tag, scanning a part, kit/trip inclusion and exclusion, carnet sub-lines / accessory lines / fold on screen, print and CSV, inventory
  CSV parent columns, backup + restore, both delete-parent choices. The fake client mirrors the parent FK, cycle check and `on delete set null`.
- `tools/test-sql.sh` — runs the migrations twice (idempotency) against a local Postgres with small Supabase stubs (`supabase/tests/local-stub.sql`)
  and then `supabase/tests/rls-test.sql` (25 checks: aal1 gets nothing, cross-user isolation, forged owner_id, foreign folders in storage, cross-owner links, anon…), then `supabase/tests/electromaxx-test.sql`
  (10 checks: 6-digit format, NULL allowed, unique per owner on insert/update, other owners may reuse a number, `show_emx` default), then
  `supabase/tests/parts-test.sql` (15 checks: part_type values, no self-parent, no cycles, cross-owner parents rejected, delete parent → parent_id NULL,
  roots-first multi-row upserts, `fold_parts` default, aal1/other users can't relink).
- `node tools/test-fmv.mjs` — v2.4 value freshness + Google AI answer parsing; v2.3 median / IQR outlier filter, query builder (no SAMPLE/serial/Electromaxx #), SerpApi parsing, source picking, fmv row round-trip.
- `GV_URL=http://127.0.0.1:8766/ node tools/browser-test-fmv.mjs` — Update values with a mocked `functions.invoke`: scopes, missing_key message,
  review table, retry, apply only selected, editor lookup, offline disable, sw. Writes `screenshots/desktop-fmv-review.png`, `iphone-fmv-review.png`.
- Icons: `node tools/make-icons.mjs` (needs playwright).
