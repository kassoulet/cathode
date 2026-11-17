#!/usr/bin/env python3
"""Generate Cathode's toolbar/store icons (transparent PNG)."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
SIZES = (16, 32, 48, 128)

BODY = (17, 23, 21, 255)
BODY_EDGE = (47, 76, 63, 255)
SCREEN = (4, 15, 10, 255)
SCANLINE = (14, 74, 46, 255)
GREEN = (92, 255, 176)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def build(size, ss=8):
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(
        (0.14 * s, 0.07 * s, 0.86 * s, 0.72 * s),
        fill=GREEN + (115,),
    )
    gd.ellipse(
        (0.34 * s, 0.26 * s, 0.66 * s, 0.52 * s),
        fill=GREEN + (85,),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(0.09 * s))
    img = Image.alpha_composite(img, glow)

    d = ImageDraw.Draw(img)

    body = (0.06 * s, 0.10 * s, 0.94 * s, 0.68 * s)
    rounded(d, body, 0.09 * s, fill=BODY, outline=BODY_EDGE, width=max(1, round(0.028 * s)))

    screen = (0.15 * s, 0.175 * s, 0.85 * s, 0.605 * s)
    rounded(d, screen, 0.05 * s, fill=SCREEN)

    line = 0.028 * s
    y = screen[1] + 0.045 * s
    while y < screen[3] - 0.02 * s:
        d.rectangle((screen[0] + 0.015 * s, y, screen[2] - 0.015 * s, y + line), fill=SCANLINE)
        y += 0.085 * s

    sheen = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon(
        [
            (screen[0] + 0.02 * s, screen[3] - 0.03 * s),
            (screen[2] - 0.02 * s, screen[1] + 0.03 * s),
            (screen[2] - 0.02 * s, screen[3] - 0.03 * s),
        ],
        fill=GREEN + (26,),
    )
    img = Image.alpha_composite(img, sheen)

    d = ImageDraw.Draw(img)

    neck = (0.44 * s, 0.66 * s, 0.56 * s, 0.79 * s)
    d.rectangle(neck, fill=BODY)

    base = (0.30 * s, 0.78 * s, 0.70 * s, 0.88 * s)
    rounded(d, base, 0.025 * s, fill=BODY, outline=BODY_EDGE, width=max(1, round(0.022 * s)))

    return img.resize((size, size), Image.LANCZOS)


def main():
    ICONS.mkdir(exist_ok=True)
    for size in SIZES:
        icon = build(size)
        icon.save(ICONS / f"icon{size}.png")
        print(f"wrote icons/icon{size}.png")


if __name__ == "__main__":
    main()
