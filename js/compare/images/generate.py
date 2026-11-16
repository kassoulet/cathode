"""Generate the synthetic example images (run: python3 generate.py)."""
import colorsys, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(7)

def bars():
    w, h = 320, 240
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    cols = [(192,192,192),(192,192,0),(0,192,192),(0,192,0),(192,0,192),(192,0,0),(0,0,192)]
    for i, c in enumerate(cols):
        d.rectangle([i*w//7, 0, (i+1)*w//7, h*2//3], fill=c)
    rev = [(0,0,192),(19,19,19),(192,0,192),(19,19,19),(0,192,192),(19,19,19),(192,192,192)]
    for i, c in enumerate(rev):
        d.rectangle([i*w//7, h*2//3, (i+1)*w//7, h*3//4], fill=c)
    for x in range(w):  # grey ramp
        v = int(255 * x / (w - 1)); d.line([x, h*3//4, x, h*7//8], fill=(v, v, v))
    for x in range(0, w, 2):  # fine vertical lines, 1px and 2px
        d.line([x, h*7//8, x, h], fill=(255, 255, 255))
    for y in range(h*7//8, h):
        for x in range(w//2, w, 8):
            d.rectangle([x, y, x+3, y], fill=(255,255,255) if (y//4) % 2 else (0,0,0))
    im.save("bars.png")

SPRITE = [
"....RRRRR.......","...RRRRRRRRR....","...SSSKKSK......","..SKSSSKSSS.....",
"..SKSSKKSSS.....","..SSKKKKKK......","....SSSSSSS.....","...RRBRRRB......",
"..RRRBRRBRRR....","..RRRBBBBRRR....","..SSBYBBYBSS....","..SSBBBBBBSS....",
"..SBBBBBBBBS....","....BBB..BBB....","...KKK....KKK...","..KKKK....KKKK..",
]
PAL = {"R":(216,40,0),"S":(252,188,176),"K":(100,48,0),"B":(0,88,248),"Y":(252,216,56)}

def sprites():
    w, h = 256, 224
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h*2//3):  # banded sky
        t = y / (h*2//3); band = int(t * 6) / 6
        d.line([0, y, w, y], fill=(int(92+90*band), int(148+70*band), 252))
    for cx, cy in ((50, 40), (170, 28), (225, 62)):  # clouds
        for dx, dy, r in ((0,0,12),(14,3,10),(-14,4,9),(6,-6,9)):
            d.ellipse([cx+dx-r, cy+dy-r*0.7, cx+dx+r, cy+dy+r*0.7], fill=(252,252,252))
    for x in range(w):  # hills
        hh = 40 + 22*math.sin(x/23.0) + 10*math.sin(x/7.0)
        d.line([x, h*2//3 - hh, x, h*2//3], fill=(0, 168, 0))
        d.point([x, int(h*2//3 - hh)], fill=(0, 120, 0))
    gy = h*2//3
    for y in range(gy, h, 16):  # brick ground
        for x in range(-16 if (y//16) % 2 else 0, w, 32):
            d.rectangle([x, y, x+30, y+14], fill=(200,76,12), outline=(0,0,0))
    for i in range(5):  # blocks and coins
        x = 40 + i*20; d.rectangle([x, 110, x+15, 125], fill=(228,92,16), outline=(0,0,0))
        d.text((x+5, 111), "?", fill=(252,252,252))
    for x in (130, 150, 170):
        d.ellipse([x, 70, x+8, 84], fill=(252,216,56), outline=(160,120,0))
    for y, row in enumerate(SPRITE):
        for x, ch in enumerate(row):
            if ch != ".": d.point([100+x, gy-16+y], fill=PAL[ch])
    im.save("sprites.png")

def terminal():
    w, h = 320, 200
    im = Image.new("RGB", (w, h), (160,160,255)); d = ImageDraw.Draw(im)
    d.rectangle([32, 36, w-33, h-37], fill=(64,64,224))
    f = ImageFont.load_default(size=8)
    lines = ["**** COMMODORE 64 BASIC V2 ****", "", "64K RAM SYSTEM  38911 BASIC BYTES FREE",
             "", "READY.", "10 FOR I=1 TO 8", "20 PRINT \"CRT TEST \";I", "30 NEXT", "RUN", "",
             "CRT TEST  1", "CRT TEST  2", "CRT TEST  3", "READY."]
    for i, t in enumerate(lines):
        d.text((36, 40 + i*10), t, font=f, fill=(160,160,255))
    d.rectangle([36, 40 + 14*10, 43, 47 + 14*10], fill=(160,160,255))
    im.save("terminal.png")

def landscape():
    w, h = 640, 480
    im = Image.new("RGB", (w, h)); px = im.load()
    for y in range(h):
        t = y / h
        for x in range(w):
            px[x, y] = (int(40+190*t), int(70+120*t), int(150+60*t*0.6))
    d = ImageDraw.Draw(im)
    d.ellipse([440, 130, 520, 210], fill=(255, 238, 180))
    glow = im.filter(ImageFilter.GaussianBlur(30)); im = Image.blend(im, glow, 0.5); d = ImageDraw.Draw(im)
    for layer, (base, col) in enumerate(((300, (110,120,150)), (340, (70,90,100)), (390, (30,52,44)))):
        pts = [(0, h)]
        yy = base
        for x in range(0, w+8, 8):
            yy += random.uniform(-14, 14) - (yy-base)*0.08
            pts.append((x, yy))
        pts.append((w, h)); d.polygon(pts, fill=col)
    for _ in range(900):  # grass / noise
        x, y = random.randrange(w), random.randrange(410, h)
        d.line([x, y, x+random.randint(-2,2), y-random.randint(3,9)], fill=(20, random.randint(70,130), 30))
    im = im.filter(ImageFilter.GaussianBlur(0.8))
    im.save("landscape.png")

def gradient():
    w, h = 512, 384
    im = Image.new("RGB", (w, h)); px = im.load()
    for y in range(h):
        for x in range(w):
            if y < h//3:
                r, g, b = colorsys.hsv_to_rgb(x/w, 1, 1)
            elif y < 2*h//3:
                v = x/(w-1); r = g = b = v
            else:
                v = x/(w-1); r, g, b = colorsys.hsv_to_rgb(0.6, 0.15 + 0.6*(y-2*h//3)/(h//3), v)
            px[x, y] = (int(r*255), int(g*255), int(b*255))
    im.save("gradient.png")

for fn in (bars, sprites, terminal, landscape, gradient):
    fn()
