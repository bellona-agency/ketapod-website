"""
Second pass over the cut-out assets: strip plate residue the matte left behind.

The difference matte keeps anything that departs from the plate, which is right
for contact shadows and neon glow but also preserves the faint film left by the
plate's own vignette and paper texture — and, where two renders sat close
together on the sheet, a stray fragment of the neighbour.

Two rules clean that up without flattening the art:

  * Keep only components that are actually part of the subject. A component
    survives if it is large, or small but genuinely solid (music notes, sparks);
    a large area of barely-there alpha is residue and goes.
  * Confine alpha to a band around the solid core. Glow and shadow live close to
    the object they come from; anything further out is plate.

Run with --dry to report without writing.
"""

import argparse
import pathlib

import numpy as np
import scipy.ndimage as nd
from PIL import Image

ASSETS = pathlib.Path("public/assets")

CORE_A = 0.55        # alpha that counts as "definitely the subject"
KEEP_FRAC = 0.02     # component size, as a fraction of the largest, worth keeping
SOLID_KEEP = 0.90    # a small component this opaque is real detail, not residue
BAND_FRAC = 0.09     # glow reach, as a fraction of the frame's short side
FLOOR = 0.05         # alpha below this is film
RIM = 3              # px of antialiasing to keep hard against the silhouette
GLOW_SAT = 0.22      # saturation above which soft pixels are glow, not shadow

# Renders that sat close together on the sheet caught a solid piece of their
# neighbour inside the crop — a green shard on the violet bubble and the
# reverse. Those pieces are opaque, so no size or alpha rule rejects them; the
# only honest fix is to say these two assets are single-object.
ONLY_LARGEST = {"bubble-violet", "bubble-green"}


def clean(img: Image.Image, name: str = "") -> tuple[Image.Image, dict]:
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    a = rgba[..., 3].copy()
    before = ((a > 0.016) & (a < 0.35)).mean() * 100

    core = a > CORE_A
    if not core.any():
        return img, {"skipped": True}

    lab, n = nd.label(core)
    sizes = nd.sum(core, lab, range(1, n + 1))
    biggest = sizes.max()
    keep = np.zeros(n + 1, dtype=bool)
    if name in ONLY_LARGEST:
        keep[int(np.argmax(sizes)) + 1] = True
    else:
        for i in range(1, n + 1):
            big_enough = sizes[i - 1] >= KEEP_FRAC * biggest
            solid = a[lab == i].max() >= SOLID_KEEP and sizes[i - 1] >= 24
            keep[i] = big_enough or solid
    core = keep[lab]

    band = max(4, int(BAND_FRAC * min(a.shape)))
    near = nd.binary_dilation(core, np.ones((3, 3)), iterations=band)

    a = np.where(near, a, 0.0)

    # Drop the baked contact shadow, keep the neon.
    #
    # These renders were lit on a pale plate, so the shadow they cast came out
    # light grey — invisible on the paper sections but an obvious white smudge
    # on the dark panels. Shadow is neutral and glow is saturated, so outside
    # the silhouette's antialiasing rim a soft pixel only survives if it carries
    # real colour. A CSS drop-shadow gives back a shadow that suits whatever
    # surface the asset actually lands on.
    mx = rgba[..., :3].max(axis=2)
    mn = rgba[..., :3].min(axis=2)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0.0)
    rim = nd.binary_dilation(core, np.ones((3, 3)), iterations=RIM)
    a = np.where(rim | (sat >= GLOW_SAT), a, 0.0)

    a = np.clip((a - FLOOR) / (1.0 - FLOOR), 0.0, 1.0)

    out = rgba.copy()
    out[..., 3] = a
    after = ((a > 0.016) & (a < 0.35)).mean() * 100
    return (
        Image.fromarray((out * 255).astype(np.uint8), "RGBA"),
        {"haze_before": round(before, 1), "haze_after": round(after, 1),
         "components": int(n), "kept": int(keep.sum())},
    )


def trim(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop(
        (max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad))
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    for f in sorted(ASSETS.glob("*.webp")):
        img = Image.open(f)
        cleaned, stats = clean(img, f.stem)
        if stats.get("skipped"):
            print(f"{f.name:24} skipped (no solid core)")
            continue
        cleaned = trim(cleaned)
        if not args.dry:
            cleaned.save(f, lossless=True, quality=100)
        print(
            f"{f.name:24} haze {stats['haze_before']:5.1f}% -> {stats['haze_after']:5.1f}%"
            f"   parts {stats['components']} -> {stats['kept']}   {img.size} -> {cleaned.size}"
        )


main()
