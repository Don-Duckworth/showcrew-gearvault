# ShowCrew GearVault — ShowCrew Tools

Offline-capable PWA for tracking computer / show gear (Millumin, PowerPoint & Keynote rigs, rack PCs, audio, network, cables, cases)
with photos and receipts, grouping it into kits / road cases, and building the **ATA Carnet General List** for travel abroad.
Plain HTML/CSS/JS, no build step. Deploy the static files (index.html, manifest.webmanifest, sw.js, css/, js/, icons/) to any HTTPS static host.

- Run locally: `python3 -m http.server 8766` in this folder → http://localhost:8766
- Install on iPad/iPhone: open the HTTPS URL in Safari → Share → Add to Home Screen. After the first load it works offline.
- Data: everything stays on the device — no server, no account. Gear/kits/trips/settings live in localStorage
  (`showcrew.gearvault.v1`); photos & receipts (images or PDFs) are stored as blobs in IndexedDB (`showcrew-gearvault`) so large files work.
  iOS can evict website storage for apps that go unused — use **Data → Export backup** regularly and keep the file in iCloud Drive / Files.
- **Gear**: name, category (editable list), make, model, serial(s), quantity, purchase date/price/currency, optional *current value*,
  vendor, country of origin, weight (kg/lb), status (active / repair / sold / retired), tags, notes, photos, receipts.
  The 📷 / 🧾 buttons open the camera or Photos on iPhone/iPad (`accept=image/*` / `image/*,application/pdf`). Search, filter (category / status / tag),
  sort, and a dashboard strip with item count, total value, carnet-readiness and kits/trips.
- **Kits / cases**: named groups (“Rack A”, “Laptop bag”) — add the case itself as a gear item if it should appear on the carnet.
- **Trips / Carnet**: destinations, dates, holder, carnet no., currency, weight unit; pick whole kits plus individual items (deduped; any line can be left off a
  single trip). The General List has item no., trade description (make + model + description), serial number, pieces, weight, value and country of origin with
  grand totals. Lines missing a serial, value or country of origin (or valued in another currency) are flagged, with a **Fix** button, and export/print warns first.
  Value = item's *current value* if set (customs wants current fair market value), else purchase price, × pieces.
  **General List / Print** opens a white-paper preview → Print / Save PDF (US Letter landscape print CSS). **CSV** is Excel-friendly (UTF-8 BOM, CRLF).
- **Data**: full JSON backup including every photo/receipt as base64; restore by *merge* or *replace*. Inventory CSV export / import
  (rows with a matching `id` update, others are added; common header aliases like “Serial Number”, “Brand”, “Country of Origin” are recognized). Template CSV.
- Tests: `node tools/test-carnet.mjs` (carnet / CSV logic); `GV_URL=http://127.0.0.1:8766/ node tools/browser-test.mjs` (headless desktop / iPad / iPhone run,
  needs playwright + a local server; writes screenshots/). Sample items exist only inside the test run — the app ships empty. Icons: `node tools/make-icons.mjs` (needs playwright).
- Updating: bump `VERSION` in sw.js when you change files so installed copies refresh.
