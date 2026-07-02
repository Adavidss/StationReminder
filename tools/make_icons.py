#!/usr/bin/env python3
"""One-time icon generation: geofence rings + center dot on WMATA red."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
RED = (191, 13, 62, 255)  # #BF0D3E
WHITE = (255, 255, 255, 255)
RING = (255, 255, 255, 110)


def draw_icon(size):
    img = Image.new("RGBA", (size, size), RED)
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    # outer geofence rings
    for frac, width_frac in ((0.36, 0.028), (0.26, 0.032)):
        r = size * frac
        w = max(2, int(size * width_frac))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RING, width=w)
    # center dot
    r = size * 0.13
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    base = draw_icon(1024)
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        base.resize((px, px), Image.LANCZOS).save(OUT / name)
        print(f"wrote icons/{name}")


if __name__ == "__main__":
    main()
