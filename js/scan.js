// ShowCrew GearVault — barcode / QR scanner for Electromaxx stickers.
// Engine: the native BarcodeDetector API where available (Chrome/Edge on Android, macOS, ChromeOS), otherwise the vendored
// ZXing library (js/vendor/zxing.min.js, loaded on demand — iOS/iPadOS Safari and desktop Firefox/Linux have no BarcodeDetector).
// Live camera via getUserMedia (needs HTTPS or localhost), plus "Take photo" and manual entry fallbacks.
import { emxFromScan } from './emx.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NATIVE_FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix'];
const ZX_FORMATS = ['CODE_128', 'CODE_39', 'CODE_93', 'CODABAR', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'ITF', 'QR_CODE', 'DATA_MATRIX'];
const ZXING_SRC = new URL('./vendor/zxing.min.js', import.meta.url).href;

let enginePromise = null;
/** Last scan outcome, for diagnostics/tests: { engine, via, emx, raw } */
export let last = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the barcode library')); document.head.appendChild(s); });
}
/** { kind: 'native'|'zxing', detect(canvas) → Promise<string[]> } */
export function getEngine() {
  return enginePromise ||= (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const sup = await window.BarcodeDetector.getSupportedFormats();
        const formats = NATIVE_FORMATS.filter(f => sup.includes(f));
        if (formats.length) {
          const det = new window.BarcodeDetector({ formats });
          return { kind: 'native', formats, detect: async src => (await det.detect(src)).map(b => b.rawValue).filter(Boolean) };
        }
      } catch (e) { console.warn('BarcodeDetector unusable, falling back to ZXing', e); }
    }
    if (!window.ZXing) await loadScript(ZXING_SRC);
    const Z = window.ZXing, hints = new Map(), reader = new Z.MultiFormatReader();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATS.map(f => Z.BarcodeFormat[f]).filter(f => f != null));
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    reader.setHints(hints);
    // 1D readers normally binarize each row with a global histogram, which fails when the sticker sits on dark gear
    // (black laptop / case). This binarizer takes rows from HybridBinarizer's locally-thresholded matrix instead.
    class MatrixRowBinarizer extends Z.HybridBinarizer {
      getBlackRow(y, row) { return this.getBlackMatrix().getRow(y, row); }
      createBinarizer(src) { return new MatrixRowBinarizer(src); }
    }
    const BINS = [MatrixRowBinarizer, Z.HybridBinarizer];
    let turn = 0;
    const decode = (canvas, bins) => {
      // ZXing's minified build console.warns a stack trace for every frame without a barcode — silence just that, synchronously.
      const warn = console.warn; console.warn = (...a) => { if (!/non-ReaderException/.test(String(a[0]))) warn.apply(console, a); };
      try {
        const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
        for (const B of bins) { try { return [reader.decodeWithState(new Z.BinaryBitmap(new B(lum))).getText()]; } catch { } finally { reader.reset(); } }
        return [];
      } finally { console.warn = warn; }
    };
    // live frames alternate binarizers (fast); photos try both
    return { kind: 'zxing', formats: ZX_FORMATS, detect: async (canvas, thorough = false) => decode(canvas, thorough ? BINS : [BINS[turn++ % 2]]) };
  })().catch(e => { enginePromise = null; throw e; });
}

/** Decode an image File/Blob (photo of a sticker). Tries as-is, then rotated 90°. */
export async function decodeImage(blob) {
  const eng = await getEngine();
  const img = await (window.createImageBitmap ? createImageBitmap(blob) : new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); }));
  const w0 = img.width, h0 = img.height, k = Math.min(1, 1600 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
  for (const rot of [0, 90]) {
    const c = document.createElement('canvas'); c.width = rot ? h : w; c.height = rot ? w : h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (rot) { g.translate(h, 0); g.rotate(Math.PI / 2); }
    g.drawImage(img, 0, 0, w, h);
    const r = await eng.detect(c, true); if (r.length) return r;
  }
  return [];
}

/**
 * Open the scanner. Resolves { emx, raw, via } (via: 'camera' | 'photo' | 'manual') or null if cancelled.
 * opts.title, opts.hint
 */
export function scan({ title = 'SCAN ELECTROMAXX STICKER', hint = 'Point the camera at the barcode or QR code on the Electromaxx sticker.' } = {}) {
  return new Promise(resolve => {
    const o = document.createElement('div'); o.className = 'overlay scan-ov'; o.id = 'scanner';
    o.innerHTML = `<div class="modal-card scan-card" role="dialog" aria-modal="true" aria-label="Barcode scanner">
      <div class="sheet-h"><div class="title">${esc(title)}</div><button class="iconbtn" data-s="close" aria-label="Close scanner">✕</button></div>
      <div class="scan-view"><video playsinline muted autoplay></video><div class="scan-reticle"><i></i></div><button class="iconbtn scan-torch" data-s="torch" hidden aria-label="Flashlight">🔦</button></div>
      <p class="hint scan-status" aria-live="polite">${esc(hint)}</p>
      <div class="scan-cands chips"></div>
      <div class="row wrap scan-alt">
        <label class="btn sm">📷 Take photo of sticker<input type="file" accept="image/*" capture="environment" data-s="photo"></label>
        <div class="joined grow"><input class="inp emx" data-s="manual" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="or type the 6 digits" autocomplete="off" aria-label="Electromaxx number"><button class="btn sm primary" data-s="use">Use</button></div>
      </div>
      <p class="hint scan-eng"></p></div>`;
    document.body.appendChild(o);
    const $ = s => o.querySelector(s), video = $('video'), status = $('.scan-status');
    let stream = null, track = null, done = false, timer = null, torch = false, engineKind = '';
    const setStatus = (t, cls = '') => { status.className = 'hint scan-status ' + cls; status.textContent = t; };
    const finish = r => {
      if (done) return; done = true; clearTimeout(timer);
      try { stream?.getTracks().forEach(t => t.stop()); } catch { }
      document.removeEventListener('keydown', onKey, true); o.remove();
      last = r ? { ...r, engine: engineKind } : null; resolve(r);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    const cands = list => { $('.scan-cands').innerHTML = list.map(c => `<button class="chip" data-s="cand" data-v="${c}">${c}</button>`).join(''); };
    const handle = (raws, via) => {
      for (const raw of raws) {
        const r = emxFromScan(raw);
        if (r.emx) { navigator.vibrate?.(50); return finish({ emx: r.emx, raw: r.raw, via }), true; }
        if (r.candidates.length) { setStatus(`Several numbers in “${r.raw.slice(0, 60)}” — tap the right one.`, 'warn'); cands(r.candidates); return true; }
        setStatus(`Read “${r.raw.slice(0, 60)}” — no 6-digit Electromaxx number in it. Keep scanning, or type it below.`, 'warn');
      }
      return false;
    };
    o.addEventListener('click', async e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      const s = b.dataset.s;
      if (s === 'close') finish(null);
      else if (s === 'cand') finish({ emx: b.dataset.v, raw: b.dataset.v, via: 'camera' });
      else if (s === 'use') { const v = $('[data-s=manual]').value.trim(); if (/^\d{6}$/.test(v)) finish({ emx: v, raw: v, via: 'manual' }); else { setStatus('The Electromaxx # is exactly 6 digits.', 'warn'); $('[data-s=manual]').focus(); } }
      else if (s === 'torch' && track) { torch = !torch; track.applyConstraints({ advanced: [{ torch }] }).catch(() => {}); b.classList.toggle('on', torch); }
    });
    o.addEventListener('input', e => { if (e.target.dataset.s === 'manual') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    o.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.s === 'manual') $('[data-s=use]').click(); });
    o.addEventListener('change', async e => {
      if (e.target.dataset.s !== 'photo') return;
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      setStatus('Reading photo…');
      try { const r = await decodeImage(f); if (!r.length) setStatus('No barcode found in that photo — try again closer, in focus, or type the number.', 'warn'); else if (!handle(r, 'photo')) { /* status set by handle */ } }
      catch (err) { setStatus('Could not read that photo: ' + (err.message || err), 'warn'); }
    });

    (async () => {
      let eng;
      try { eng = await getEngine(); $('.scan-eng').textContent = eng.kind === 'native' ? 'Scanner: built-in barcode detector' : 'Scanner: ZXing (built into GearVault)'; o.dataset.engine = engineKind = eng.kind; }
      catch (err) { setStatus('Barcode scanning is unavailable here (' + (err.message || err) + ') — type the number below.', 'warn'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setStatus(window.isSecureContext === false ? 'The camera needs a secure (https) page — use “Take photo” or type the number.' : 'No live camera access in this browser — use “Take photo” or type the number.', 'warn'); $('.scan-view').classList.add('off'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (err) {
        $('.scan-view').classList.add('off');
        setStatus(err && err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site (iPhone: Settings › Safari › Camera), or use “Take photo” / type the number.' : 'Could not start the camera (' + (err.message || err.name || err) + ') — use “Take photo” or type the number.', 'warn');
        return;
      }
      if (done) { stream.getTracks().forEach(t => t.stop()); return; }
      track = stream.getVideoTracks()[0];
      try { if (track.getCapabilities?.().torch) $('.scan-torch').hidden = false; } catch { }
      video.srcObject = stream; o.dataset.live = '1';
      try { await video.play(); } catch { }
      const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
      let frame = 0;
      const tick = async () => {
        if (done) return;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (vw && vh && !window.__GV_SCAN_PAUSE__) { // pause hook: tests only
          // alternate (every 2 frames) between the reticle region and the whole frame (big QR codes), downscaled for speed
          const full = Math.floor(frame++ / 2) % 2 === 1;
          const cw = Math.round(vw * (full ? 1 : 0.86)), ch = Math.round(vh * (full ? 1 : 0.6)), k = Math.min(1, 960 / cw);
          c.width = Math.round(cw * k); c.height = Math.round(ch * k);
          g.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
          try { const r = await eng.detect(c); if (r.length && handle(r, 'camera')) return; } catch (err) { console.warn('detect failed', err); }
        }
        timer = setTimeout(tick, eng.kind === 'native' ? 80 : 160);
      };
      tick();
    })();
  });
}
