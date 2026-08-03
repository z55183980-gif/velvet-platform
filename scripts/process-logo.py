"""Crop, remove cream background, strip watermark, compress Velvet logo."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC = Path(r"D:\Velvet\Velve logo.png")
OUT_DIR = Path(r"D:\Velvet\velvet-platform\apps\web\public")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def near_bg(r: int, g: int, b: int, a: int) -> bool:
    """Treat pale cream / near-white pixels as background."""
    if a < 8:
        return True
    # High luminance + low chroma (cream/white)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx >= 220 and (mx - mn) <= 45:
        return True
    if r >= 230 and g >= 225 and b >= 210:
        return True
    # Soft fringe of cream
    if r >= 200 and g >= 195 and b >= 180 and (mx - mn) <= 35 and (r + g + b) / 3 >= 205:
        return True
    return False


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size
    print(f"source: {w}x{h}")

    pixels = img.load()
    assert pixels is not None

    # 1) Remove background (make transparent)
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if near_bg(r, g, b, a):
                pixels[x, y] = (r, g, b, 0)
            else:
                # Soften near-bg fringe to reduce halo
                mx, mn = max(r, g, b), min(r, g, b)
                lum = (r + g + b) / 3
                if lum > 185 and (mx - mn) < 55 and a > 0:
                    # partially fade light edges
                    fade = int(max(0, min(255, (lum - 185) / 50 * 180)))
                    pixels[x, y] = (r, g, b, max(0, a - fade))

    # 2) Mask out bottom-right watermark region (Doubao AI mark)
    # Keep logo body; wipe a strip in the lower-right corner if residual text exists.
    wipe_x0 = int(w * 0.72)
    wipe_y0 = int(h * 0.88)
    for y in range(wipe_y0, h):
        for x in range(wipe_x0, w):
            r, g, b, a = pixels[x, y]
            # Watermark is pale/semi-transparent gray text — kill light low-sat pixels there
            mx, mn = max(r, g, b), min(r, g, b)
            if a < 160 or (mx - mn) < 40 or (r + g + b) / 3 > 160:
                pixels[x, y] = (0, 0, 0, 0)

    # 3) Crop to opaque content bbox with small padding
    bbox = img.getbbox()
    if not bbox:
        raise SystemExit("No visible content after background removal")
    left, top, right, bottom = bbox
    pad = 12
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(w, right + pad)
    bottom = min(h, bottom + pad)
    cropped = img.crop((left, top, right, bottom))
    print(f"cropped: {cropped.size} from bbox {bbox}")

    # 4) Fit into square canvas (transparent) for consistent UI usage
    cw, ch = cropped.size
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)

    # 5) Export sizes
    targets = {
        "logo.png": 256,       # navbar / general
        "logo@2x.png": 512,    # retina
        "apple-touch-icon.png": 180,
        "favicon-32.png": 32,
    }

    for name, size in targets.items():
        out = square.copy()
        out.thumbnail((size, size), Image.Resampling.LANCZOS)
        # Ensure exact canvas for icons
        if out.size != (size, size):
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            ox = (size - out.size[0]) // 2
            oy = (size - out.size[1]) // 2
            canvas.paste(out, (ox, oy), out)
            out = canvas
        path = OUT_DIR / name
        out.save(path, format="PNG", optimize=True)
        print(f"wrote {path} ({path.stat().st_size} bytes) {out.size}")

    # Also write a webp master for lighter delivery
    webp = square.copy()
    webp.thumbnail((256, 256), Image.Resampling.LANCZOS)
    webp_path = OUT_DIR / "logo.webp"
    webp.save(webp_path, format="WEBP", quality=90, method=6)
    print(f"wrote {webp_path} ({webp_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
