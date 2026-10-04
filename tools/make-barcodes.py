#!/usr/bin/env python3
"""Generate barcode fixtures for tools/browser-test.mjs (needs: pip install python-barcode qrcode pillow).
Writes tools/fixtures/*.png and a fake-camera video tools/fixtures/camera-004222.y4m (Chromium --use-file-for-fake-video-capture)."""
import os, barcode, qrcode
from barcode.writer import ImageWriter
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures'); os.makedirs(HERE, exist_ok=True)
opts = dict(module_height=18, quiet_zone=6, font_size=10, text_distance=4, dpi=200)
def bc(kind, data, name, **kw):
    cls = barcode.get_barcode_class(kind)
    img = cls(data, writer=ImageWriter(), **kw).render(opts)
    img.save(os.path.join(HERE, name)); return img
bc('code128', '004217', 'code128-004217.png')
bc('code39', 'EMX-004218', 'code39-EMX-004218.png', add_checksum=False)
bc('itf', '004219', 'itf-004219.png')
bc('ean13', '000000004220', 'ean13-004220.png')        # library appends the check digit
q = qrcode.make('https://electromaxx.example/gear/004221'); q.save(os.path.join(HERE, 'qr-004221.png'))
bc('code128', 'SN-ABCDEFG', 'code128-no-number.png')   # readable, but no 6-digit number

# sticker on a desk, as a 640x480 camera feed (I420 y4m)
big = dict(opts, module_width=0.5, module_height=14, dpi=300)
tag = barcode.get_barcode_class('code128')('004222', writer=ImageWriter()).render(big).convert('L')
W, H = 640, 480
bg = Image.new('L', (W, H), 120); d = ImageDraw.Draw(bg)
d.rectangle([0, H - 70, W, H], fill=95)  # desk edge
tag.thumbnail((470, 300)); sticker = Image.new('L', (tag.width + 30, tag.height + 30), 250); sticker.paste(tag, (15, 15))
bg.paste(sticker, ((W - sticker.width) // 2, (H - sticker.height) // 2)); pass
bg.convert('RGB').save(os.path.join(HERE, 'camera-004222.png'))
with open(os.path.join(HERE, 'camera-004222.y4m'), 'wb') as f:
    f.write(b'YUV4MPEG2 W%d H%d F10:1 Ip A1:1 C420jpeg\n' % (W, H))
    y = bg.tobytes(); uv = bytes([128]) * (W * H // 4)
    for _ in range(1): f.write(b'FRAME\n' + y + uv + uv)
print(sorted(os.listdir(HERE)))
