"""
Turn the supplied wordmark (white lettering on solid black, no alpha) into a
tintable mask.

Alpha is taken straight from luminance, so the letterforms keep their
antialiased edges, and the RGB is flattened to white. The result is used as a
CSS `mask-image`, which means one file renders in ink on the paper header and
in white on the dark footer without shipping two assets or hard-coding a colour.
"""

import pathlib

import numpy as np
from PIL import Image

SRC = pathlib.Path(r"C:\Users\Datis\Downloads\ketapod.png")
OUT = pathlib.Path("public/assets/wordmark.png")

# Black plate never reaches 0 after JPEG-ish processing; lift the floor so the
# background is fully transparent instead of a faint grey haze.
FLOOR, CEIL = 26, 236


def main() -> None:
    rgb = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    alpha = np.clip((lum - FLOOR) / (CEIL - FLOOR), 0, 1)
    out = Image.fromarray(
        np.dstack(
            [
                np.full(alpha.shape, 255, np.uint8),
                np.full(alpha.shape, 255, np.uint8),
                np.full(alpha.shape, 255, np.uint8),
                (alpha * 255).astype(np.uint8),
            ]
        ),
        "RGBA",
    )

    bbox = out.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        out = out.crop(bbox)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f"{OUT} {out.size}  ratio {out.width / out.height:.3f}")


main()
