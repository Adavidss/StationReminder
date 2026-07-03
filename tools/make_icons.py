#!/usr/bin/env python3
"""One-time icon generation: minimal black & white geofence mark."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size):
    img = Image.new("RGBA", (size, size), BLACK)
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    # one bold geofence ring
    r = size * 0.30
    w = max(2, round(size * 0.055))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=w)
    # solid center dot
    rd = size * 0.115
    d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], fill=WHITE)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    base = draw_icon(1024)
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        base.resize((px, px), Image.LANCZOS).save(OUT / name)
        print(f"wrote icons/{name}")


if __name__ == "__main__":
    main()
