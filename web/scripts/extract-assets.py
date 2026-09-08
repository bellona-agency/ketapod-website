"""
Cut the individual 3D renders out of the generated gallery sheet.

The sheet is a JPEG (no alpha) with every object composited over a flat, light,
neutral plate — which is exactly the case a *difference matte* handles well:
alpha comes from how far each pixel sits from the plate colour, so soft contact
shadows and the neon glows survive as partial alpha instead of being clipped to
a hard silhouette. Interior areas that happen to match the plate (the white
headphones) are rescued by hole-filling the solid mask.

The Persian caption chips are painted out first, because they sit inside the
crop rectangles and would otherwise be matted in along with the object.
"""

import cv2
import numpy as np
import scipy.ndimage as nd
from PIL import Image, ImageFilter

SRC = r"C:\Users\Datis\Downloads\Gemini_Generated_Image_o390roo390roo390.jpg"
OUT = r"D:\ketapod\public\assets"
PREVIEW = (
    r"C:\Users\Datis\AppData\Local\Temp\claude"
    r"\D--ketapod\dadf8ec2-77b7-48b3-bd9e-d9c3ab6cb41b\scratchpad"
)

# Caption chips to erase before matting — (x0, y0, x1, y1) in sheet pixels.
LABELS = [
    (440, 885, 725, 962),    # گوشی و هدفون
    (1098, 872, 1385, 948),  # شخصیت کودک
    (70, 1378, 268, 1472),   # میکروفون (left)
    (850, 1362, 1072, 1458),  # میکروفون (right)
    (848, 1874, 1036, 1952),  # کره شفاف
    (515, 2496, 755, 2578),  # کارت‌های نماد
    (1064, 2490, 1362, 2570),  # عناصر رابط کاربری
]

# Crop rectangles, kept a comfortable margin inside each plate so the border
# ring used to sample the plate colour is never contaminated by a gutter.
BOXES = {
    "phone-headphones": (58, 188, 708, 880),
    "kid-scene": (798, 240, 1350, 900),
    "microphone": (36, 1024, 566, 1706),
    "globe": (498, 1372, 1008, 1886),
    "icon-cards": (36, 1892, 736, 2486),
    "ui-elements": (790, 1962, 1374, 2486),
}

SOFT_T = 16.0   # difference at which a pixel counts as fully opaque
SOLID_DIFF = 9.0  # departure from the plate that counts as subject


def erase_labels(sheet: np.ndarray) -> np.ndarray:
    mask = np.zeros(sheet.shape[:2], np.uint8)
    for x0, y0, x1, y1 in LABELS:
        cv2.rectangle(mask, (x0, y0), (x1, y1), 255, -1)
    return cv2.inpaint(sheet, mask, 7, cv2.INPAINT_TELEA)


def plate_surface(p: np.ndarray, band: int = 10) -> np.ndarray:
    """
    Least-squares quadratic fit of the plate through the crop's border ring.

    The plates carry a soft vignette, so a single median colour leaves a bright
    haze where the gradient drifts past the matte threshold. Fitting a surface
    instead makes the plate cancel out across the whole crop.
    """
    h, w, _ = p.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ring = np.zeros((h, w), bool)
    ring[:band] = ring[-band:] = True
    ring[:, :band] = ring[:, -band:] = True

    Y = (yy / h)[ring]
    X = (xx / w)[ring]
    A = np.stack([np.ones_like(X), X, Y, X * X, Y * Y, X * Y], axis=1)
    basis = np.stack(
        [np.ones_like(xx), xx / w, yy / h, (xx / w) ** 2, (yy / h) ** 2, (xx / w) * (yy / h)],
        axis=-1,
    )
    out = np.empty_like(p)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, p[..., c][ring], rcond=None)
        out[..., c] = basis @ coef
    return out


def plate_estimate(p: np.ndarray, occluded: np.ndarray) -> np.ndarray:
    """
    Rebuild the plate underneath the subject.

    A quadratic fit is not enough — the plates carry an uneven vignette and a
    faint paper texture, and whatever the fit misses survives as a grey cloud
    around the cut-out. Instead the subject is masked out and inpainted at 1/8
    scale, which reconstructs the real local gradient and smooths away texture
    in one step.
    """
    h, w, _ = p.shape
    sw, sh = max(w // 8, 8), max(h // 8, 8)
    small = cv2.resize(p.astype(np.uint8), (sw, sh), interpolation=cv2.INTER_AREA)
    mask = cv2.resize(
        occluded.astype(np.uint8) * 255, (sw, sh), interpolation=cv2.INTER_LINEAR
    )
    mask = (mask > 40).astype(np.uint8)
    filled = cv2.inpaint(small, mask, 6, cv2.INPAINT_TELEA)
    up = cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    return cv2.GaussianBlur(up, (0, 0), 9)


def matte(crop: Image.Image, feather: float = 1.0) -> Image.Image:
    p = np.asarray(crop.convert("RGB")).astype(np.float32)

    # Pass 1: a coarse surface fit is only good enough to locate the subject.
    rough = np.abs(p - plate_surface(p)).max(axis=2) > 22
    rough = nd.binary_closing(rough, np.ones((9, 9)))
    rough = nd.binary_fill_holes(rough)
    rough = nd.binary_dilation(rough, np.ones((3, 3)), iterations=10)

    # Pass 2: matte against the reconstructed plate.
    bg = plate_estimate(p, rough)
    diff = np.abs(p - bg).max(axis=2)

    # The silhouette needs a *hard* threshold. The render bounced coloured light
    # and a soft shadow onto its own plate, and both clear any gentle cut — which
    # is what bloats the mask into a blob. Only a strong departure from the plate
    # counts as the subject; the gentle field is edge antialiasing at most.
    solid = nd.binary_opening(diff > SOLID_DIFF, np.ones((3, 3)))
    lab, n = nd.label(solid)
    if n:
        # A blob that runs off the crop edge is a neighbouring tile bleeding in —
        # unless it is the subject itself, which can graze the edge.
        border = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1])
        sizes = nd.sum(solid, lab, range(1, n + 1))
        main = int(np.argmax(sizes)) + 1
        keep = np.zeros(n + 1, dtype=bool)
        for i in range(1, n + 1):
            keep[i] = i == main or (sizes[i - 1] > 260 and i not in border)
        solid = keep[lab]
    solid = nd.binary_closing(solid, np.ones((9, 9)))
    solid = nd.binary_fill_holes(solid)

    # Alpha: opaque inside the silhouette, antialiased for a couple of pixels
    # around it, nothing beyond.
    a = np.clip(diff / SOFT_T, 0.0, 1.0)
    edge = nd.binary_dilation(solid, np.ones((3, 3)), iterations=4)
    a = np.where(solid, 1.0, np.where(edge, a, 0.0))

    # Un-premultiply so edge pixels carry the object's own colour rather than a
    # blend with the old plate.
    rgb = np.clip(bg + (p - bg) / np.maximum(a, 1e-3)[..., None], 0, 255)

    out = Image.fromarray(
        np.dstack([rgb.astype(np.uint8), (a * 255).astype(np.uint8)]), "RGBA"
    )
    if feather:
        out.putalpha(out.getchannel("A").filter(ImageFilter.GaussianBlur(feather)))
    return out


def trim(img: Image.Image, pad: int = 10) -> Image.Image:
    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop(
        (
            max(0, l - pad),
            max(0, t - pad),
            min(img.width, r + pad),
            min(img.height, b + pad),
        )
    )


def main():
    sheet = cv2.cvtColor(np.asarray(Image.open(SRC).convert("RGB")), cv2.COLOR_RGB2BGR)
    clean = Image.fromarray(cv2.cvtColor(erase_labels(sheet), cv2.COLOR_BGR2RGB))
    clean.save(rf"{PREVIEW}\sheet-clean.png")

    results = {}
    for name, box in BOXES.items():
        cut = trim(matte(clean.crop(box)))
        cut.save(rf"{OUT}\{name}.png")
        results[name] = cut
        print(f"{name:18} {cut.size}")

    for label, plate in (("paper", (250, 248, 244)), ("night", (23, 18, 51))):
        cols, cell = 3, 430
        rows = (len(results) + cols - 1) // cols
        out = Image.new("RGB", (cols * cell, rows * cell), plate)
        for i, img in enumerate(results.values()):
            k = img.copy()
            k.thumbnail((cell - 30, cell - 30))
            out.paste(
                k,
                ((i % cols) * cell + (cell - k.width) // 2,
                 (i // cols) * cell + (cell - k.height) // 2),
                k,
            )
        out.save(rf"{PREVIEW}\preview-{label}.png")
    print("previews written")


main()
