"""
Pull every render onto one brand hue.

The 3D art was generated across a purple-to-blue spread (hue 235–275) while the
brand blue sits at 236. Section by section it looked fine; scrolling the whole
page it read as several different palettes, because the microphone is violet,
the globe is blue and the kid's beanbag is violet again.

Rather than rotating each asset by a fixed amount, the whole blue/violet band is
*compressed* onto a narrow brand band. Compression keeps the relative hue
variation inside a single render — the highlight on a sphere is still a slightly
different hue from its shadow — so the art stays dimensional instead of turning
into a flat wash of one colour.

Genuine accent hues (the green bubbles, the amber envelope, the kid's yellow
hoodie) are outside the band and are left alone.

**This is not idempotent.** The target band sits inside the source band, so a
second pass compresses an already-harmonised render again — 229–248 becomes
231–236, which is the flat wash the compression was designed to avoid. Pass the
files to harmonise; the bare glob is there for the first run over a fresh sheet
and will re-hue everything it finds.

Usage:
    python scripts/harmonise-assets.py --dry public/assets/ai-*.webp
"""

import argparse
import colorsys
import glob
import pathlib

import numpy as np
from PIL import Image

# Source band to normalise, in degrees.
SRC_LO, SRC_HI = 222.0, 292.0
# Target band. Narrow, centred on the brand's 236 with a little room to breathe.
DST_LO, DST_HI = 229.0, 248.0
# Below this saturation a pixel is effectively neutral; shifting it does nothing
# but risk tinting the whites.
MIN_SAT = 0.10

rgb_to_hsv = np.vectorize(colorsys.rgb_to_hsv)
hsv_to_rgb = np.vectorize(colorsys.hsv_to_rgb)


def harmonise(img: Image.Image) -> tuple[Image.Image, float]:
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]

    h, s, v = rgb_to_hsv(r, g, b)
    deg = h * 360.0

    band = (deg >= SRC_LO) & (deg <= SRC_HI) & (s >= MIN_SAT)
    if not band.any():
        return img, 0.0

    t = (deg[band] - SRC_LO) / (SRC_HI - SRC_LO)
    deg[band] = DST_LO + t * (DST_HI - DST_LO)

    r2, g2, b2 = hsv_to_rgb(deg / 360.0, s, v)
    out = a.copy()
    out[..., 0], out[..., 1], out[..., 2] = r2, g2, b2
    return (
        Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA"),
        band.mean() * 100,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("files", nargs="*", help="defaults to every asset — see above")
    args = ap.parse_args()

    for f in sorted(args.files or glob.glob("public/assets/*.webp")):
        p = pathlib.Path(f)
        img = Image.open(p)
        out, pct = harmonise(img)
        if pct == 0.0:
            print(f"{p.name:24} untouched (no pixels in band)")
            continue
        if not args.dry:
            out.save(p, lossless=True, quality=100)
        print(f"{p.name:24} {pct:5.1f}% of pixels re-hued")


main()
