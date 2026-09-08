"""
Slice the 3D asset sheet into individual transparent PNG/WebP files.

The sheet already carries a real alpha channel, so there is no matting to do —
objects are found by labelling connected regions of non-transparent pixels,
dilated slightly first so that a render and its own soft shadow (or a cluster
like the phone + headphones + blobs) stay together as one piece.

Usage:
    python scripts/slice-assets.py --survey     # numbered contact sheet
    python scripts/slice-assets.py              # write public/assets/*.webp
"""

from __future__ import annotations

import argparse
import pathlib

import numpy as np
import scipy.ndimage as nd
from PIL import Image, ImageDraw

SHEET = pathlib.Path(
    r"C:\Users\Datis\Downloads\ChatGPT Image Aug 29, 2026, 06_08_48 PM.png"
)
OUT = pathlib.Path("public/assets")
SURVEY = pathlib.Path("scripts/_survey.png")

ALPHA_FLOOR = 110  # keep soft drop shadows out of the labelling pass
MIN_AREA = 2500  # ignore speckles and stray confetti dots
GLUE = 4  # just enough to bridge antialiasing, not enough to fuse neighbours


def components(img: Image.Image):
    alpha = np.asarray(img)[..., 3]
    solid = alpha > ALPHA_FLOOR
    glued = nd.binary_closing(solid, np.ones((GLUE, GLUE)))
    lab, n = nd.label(glued)
    boxes = []
    for i, sl in enumerate(nd.find_objects(lab), start=1):
        if (lab[sl] == i).sum() < MIN_AREA:
            continue
        ys, xs = sl
        boxes.append((xs.start, ys.start, xs.stop, ys.stop))
    # Reading order: top-to-bottom in bands, then right-to-left (RTL sheet).
    boxes.sort(key=lambda b: (b[1] // 120, -b[0]))
    return boxes


def survey(img: Image.Image, boxes) -> None:
    plate = Image.new("RGB", img.size, (255, 255, 255))
    plate.paste(img, (0, 0), img)
    d = ImageDraw.Draw(plate)
    for i, (l, t, r, b) in enumerate(boxes):
        d.rectangle([l, t, r, b], outline=(220, 30, 90), width=3)
        d.rectangle([l, t, l + 46, t + 34], fill=(220, 30, 90))
        d.text((l + 12, t + 8), str(i), fill=(255, 255, 255))
    SURVEY.parent.mkdir(parents=True, exist_ok=True)
    plate.save(SURVEY)
    print(f"{len(boxes)} pieces -> {SURVEY}")
    for i, b in enumerate(boxes):
        print(f"  {i:2}  x{b[0]:5} y{b[1]:5}  {b[2] - b[0]:4}×{b[3] - b[1]:4}")


# Piece index -> output name, read off a `--survey` pass. Re-run the survey
# after changing the sheet: the indices are positional, not stable identifiers.
NAMES: dict[int, str] = {
    0: "microphone",          # dark mic + waveform — Interactive Demo
    2: "headphones",          # white/violet cans — Hero, floating
    3: "waveform-coin",       # violet disc — Hero, floating
    4: "phone-headphones",    # full device composition (unused: the hero device is coded)
    6: "tile-books",          # ─┐
    7: "tile-globe",          #  │ the five soft-square icon tiles —
    8: "tile-kid",            #  │ Why Us cards
    9: "tile-chat",           #  │
    10: "tile-headphones",    # ─┘
    11: "bubble-violet",      # FAQ
    12: "books-play",         # spare
    14: "globe",              # Localization
    15: "kid-scene",          # Kids
    16: "bubble-green",       # FAQ
    17: "bar-chart",          # spare
    18: "leaf",               # spare
    19: "headphones-play",    # magenta cans + play — Final CTA
    20: "envelope",           # Lead form
    21: "search-bar",         # spare
}


def cut(img: Image.Image, box, pad: int = 6) -> Image.Image:
    l, t, r, b = box
    piece = img.crop(
        (max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad))
    )
    # Re-trim on the real alpha, then normalise the near-opaque body to 255.
    bbox = piece.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    if bbox:
        piece = piece.crop(bbox)
    a = np.asarray(piece).copy()
    a[..., 3] = np.where(a[..., 3] > 240, 255, a[..., 3])
    return Image.fromarray(a, "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", action="store_true")
    args = ap.parse_args()

    img = Image.open(SHEET).convert("RGBA")
    boxes = components(img)

    if args.survey or not NAMES:
        survey(img, boxes)
        if args.survey:
            return

    OUT.mkdir(parents=True, exist_ok=True)
    for idx, name in NAMES.items():
        piece = cut(img, boxes[idx])
        piece.save(OUT / f"{name}.webp", quality=92, method=6)
        print(f"{name:22} {piece.size}")


main()
