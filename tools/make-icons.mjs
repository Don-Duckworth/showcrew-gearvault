// Generates PNG app icons using headless Chromium's canvas. Run: node tools/make-icons.mjs (needs playwright)
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = new URL('../icons/', import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage();
const sizes = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, false], ['favicon-32.png', 32, false]];
for (const [name, size, maskable] of sizes) {
  const data = await page.evaluate(([S, maskable]) => {
    const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    const g = x.createRadialGradient(S * .5, S * .35, 0, S * .5, S * .5, S * .75); g.addColorStop(0, '#0d2238'); g.addColorStop(1, '#03060c');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    // grid
    x.strokeStyle = 'rgba(0,229,255,0.10)'; x.lineWidth = Math.max(1, S / 256);
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(i * S / 8, 0); x.lineTo(i * S / 8, S); x.moveTo(0, i * S / 8); x.lineTo(S, i * S / 8); x.stroke(); }
    // road case: body, lid seam, handle, two latches; magenta asset tag
    const k = maskable ? 0.6 : 0.78, w = S * k, h = w * 0.68, X = (S - w) / 2, Y = (S - h) / 2 + h * 0.06, r = w * 0.06;
    const rr = (x0, y0, ww, hh, rad) => { x.beginPath(); x.moveTo(x0 + rad, y0); x.arcTo(x0 + ww, y0, x0 + ww, y0 + hh, rad); x.arcTo(x0 + ww, y0 + hh, x0, y0 + hh, rad); x.arcTo(x0, y0 + hh, x0, y0, rad); x.arcTo(x0, y0, x0 + ww, y0, rad); x.closePath(); };
    x.shadowColor = '#00e5ff'; x.shadowBlur = S / 22; x.strokeStyle = '#00e5ff'; x.lineWidth = Math.max(2, S / 28);
    rr(X, Y, w, h, r); x.stroke();
    x.beginPath(); x.moveTo(S / 2 - w * .17, Y); x.lineTo(S / 2 - w * .17, Y - h * .14); x.lineTo(S / 2 + w * .17, Y - h * .14); x.lineTo(S / 2 + w * .17, Y); x.stroke();
    x.lineWidth = Math.max(1, S / 70); x.globalAlpha = .75; x.beginPath(); x.moveTo(X, Y + h * .3); x.lineTo(X + w, Y + h * .3); x.stroke(); x.globalAlpha = 1;
    x.lineWidth = Math.max(1.5, S / 48);
    for (const lx of [X + w * .14, X + w * .72]) { x.fillStyle = '#05080f'; rr(lx, Y + h * .2, w * .14, h * .2, w * .02); x.fill(); x.stroke(); }
    x.shadowColor = '#ff3df2'; x.strokeStyle = '#ff3df2'; x.lineWidth = Math.max(1.5, S / 40);
    const tw = w * .34, th = h * .3, tx = X + w * .58, ty = Y + h * .52;
    rr(tx, ty, tw, th, w * .03); x.stroke();
    if (S >= 64) { x.lineWidth = Math.max(1, S / 64); x.beginPath(); x.moveTo(tx + tw * .18, ty + th * .5); x.lineTo(tx + tw * .82, ty + th * .5); x.stroke(); }
    return c.toDataURL('image/png').split(',')[1];
  }, [size, maskable]);
  fs.writeFileSync(out + name, Buffer.from(data, 'base64')); console.log('wrote', name);
}
await browser.close();
