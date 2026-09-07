"""
Cut the six کتاب‌یار renders out of the section mockup.

Unlike `extract-assets.py`, the source here is not a gallery sheet of objects on
one flat plate — it is a full render of the "چه کارهایی می‌کند" section, cards
and Persian copy included. So the crop for each object is derived from the card
grid rather than hand-measured: the cards are the brightest regions on the
sheet, which locates the three columns and two rows, and each render sits in the
leading (right-to-left: left) quarter of its own card, clear of the text block.

Matting is a difference matte against the card, sampled per crop from its border
ring, because the card carries a gentle gradient and a single global plate
colour would leave a wash on one side of the sheet. Interiors that legitimately
match the card — the book's white pages, the message card behind the question
bubble — are recovered by filling holes in the solid mask before the soft alpha
is applied, so they do not punch through.

Usage:
    python scripts/extract-assistant-assets.py --survey   # boxed contact sheet
    python scripts/extract-assistant-assets.py            # write the webp files
"""

from __future__ import annotations

import argparse
import pathlib

import numpy as np
import scipy.ndimage as nd
from PIL import Image, ImageDraw

SHEET = pathlib.Path(
    r"C:\Users\navid\Downloads\ChatGPT Image Sep 7, 2026, 10_02_39 PM.png"
)
OUT = pathlib.Path("public/assets")
SURVEY = pathlib.Path("scripts/_survey-assistant.png")

# Card detection.
CARD_LUM = 244.0   # a card is brighter than the page wash behind it
CARD_FILL = 0.30   # fraction of a row that must be card to count
CARD_MIN = 40      # px; ignore slivers
CARD_WIDE = 300    # px; a real card, not a bright patch of the page wash
LID = (4, 19)      # band below a card's top edge, clear of its render and copy

# The render sits in the leading quarter of the card. Measured against the
# narrowest gap on the sheet (the brain card, where the copy starts 35px past
# the orbit) and then pulled in a further 12px of safety.
ART_INSET = 4
ART_WIDTH = 246
# The row spans reach the card's own edge, and its border and drop shadow matte
# in as a straight band across the bottom of the cut-out. The renders sit well
# inside their cards, so pulling the crop off the edge costs nothing.
ART_VINSET = 12

# Difference matte.
SOFT_LO = 3.0    # departure from the card that starts to count as subject
SOFT_HI = 15.0   # departure at which a pixel is fully opaque
SOLID = 11.0     # departure that counts as core, for the hole-filling pass
BORDER = 8       # px of border ring sampled for the card colour

PAD = 10         # transparent margin kept around the final bbox

# Reading order is the section's own: top row then bottom, right to left.
NAMES = [
    "ai-context",   # می‌داند کجای کتاب هستید — question bubble
    "ai-summary",   # خلاصه کتاب و خلاصه فصل — open book
    "ai-quiz",      # کوییز از محتوا — AI brain
    "ai-search",    # جستجوی معنایی — magnifier over a document
    "ai-voice",     # پرسش با صدا — microphone
    "ai-transcript",  # روی متن واقعی کتاب — waveform discs
]


def runs(profile: np.ndarray, lo: float, wide: int) -> list[tuple[int, int]]:
    """Contiguous stretches where the sheet reads as card."""
    out: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(profile):
        if v >= lo and start is None:
            start = i
        elif v < lo and start is not None:
            if i - start > wide:
                out.append((start, i))
            start = None
    if start is not None and len(profile) - start > wide:
        out.append((start, len(profile)))
    return out


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def rows_of(rgb: np.ndarray) -> list[tuple[int, int]]:
    """The two card rows, from how much of each scanline is card."""
    card = luma(rgb) > CARD_LUM
    return runs(card.mean(axis=1), CARD_FILL, CARD_MIN)


def cols_of(rgb: np.ndarray, top: int) -> list[tuple[int, int]]:
    """The three card columns in one row.

    Read off a thin band just below the card's top edge rather than off the
    whole column: down where the renders are, an object dark enough to fail the
    brightness test splits its own card into two spans with a gap wider than the
    real gutter, so no merge rule can tell a card apart from a gutter. Up here
    there is nothing but card and gutter.
    """
    band = luma(rgb[top + LID[0] : top + LID[1]]).mean(axis=0)
    return runs(band > CARD_LUM, 0.5, CARD_WIDE)


def matte(crop: np.ndarray) -> Image.Image:
    """Lift one render off its card."""
    h, w, _ = crop.shape

    ring = np.ones((h, w), bool)
    ring[BORDER:-BORDER, BORDER:-BORDER] = False
    plate = np.median(crop[ring], axis=0)

    diff = np.abs(crop - plate).max(axis=2)

    solid = nd.binary_fill_holes(diff > SOLID)
    alpha = np.clip((diff - SOFT_LO) / (SOFT_HI - SOFT_LO), 0, 1)
    alpha = np.maximum(alpha, solid.astype(np.float32))

    # Speckle from the card's own texture reads as a faint dust of alpha.
    lab, n = nd.label(alpha > 0.25)
    if n:
        sizes = nd.sum(alpha > 0.25, lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.flatnonzero(sizes > 0.004 * sizes.max()))
        alpha *= keep

    rgba = np.dstack([crop, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")

    bbox = img.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    if bbox:
        l, t, r, b = bbox
        img = img.crop(
            (max(0, l - PAD), max(0, t - PAD), min(w, r + PAD), min(h, b + PAD))
        )
    return img


def boxes(rgb: np.ndarray) -> list[tuple[int, int, int, int]]:
    rows = rows_of(rgb)
    if len(rows) != 2:
        raise SystemExit(f"expected 2 card rows, found {len(rows)}")

    out = []
    for top, bottom in rows:
        cols = cols_of(rgb, top)
        if len(cols) != 3:
            raise SystemExit(f"expected 3 cards in the row at y={top}, found {len(cols)}")
        for left, _ in reversed(cols):  # RTL
            x = left + ART_INSET
            out.append((x, top + ART_VINSET, x + ART_WIDTH, bottom - ART_VINSET))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", action="store_true")
    args = ap.parse_args()

    sheet = Image.open(SHEET).convert("RGB")
    rgb = np.asarray(sheet).astype(np.float32)
    crops = boxes(rgb)

    if args.survey:
        plate = sheet.copy()
        d = ImageDraw.Draw(plate)
        for name, (l, t, r, b) in zip(NAMES, crops):
            d.rectangle([l, t, r, b], outline=(220, 30, 90), width=3)
            d.text((l + 6, t + 6), name, fill=(220, 30, 90))
        plate.save(SURVEY)
        print(f"{len(crops)} boxes -> {SURVEY}")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    for name, (l, t, r, b) in zip(NAMES, crops):
        img = matte(rgb[t:b, l:r])
        path = OUT / f"{name}.webp"
        img.save(path, "WEBP", quality=92, method=6)
        print(f"{path}  {img.size}  {path.stat().st_size / 1024:.0f}KB")


main()
