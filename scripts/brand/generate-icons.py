"""
Generates every app icon from the ONE source picture, assets/brand/em-chess-icon-source.png (command #35, TESTING.md "App icon").

    python3 -I scripts/brand/generate-icons.py          # needs Pillow and numpy (a maintainer's tool; CI only READS the committed PNGs)

The source is a black knight with a green / silver ring on a dark rounded square (1254 x 1254; the square's own corners and the dark surround are NOT part of the artwork):
  - icon.png                        1024 x 1024, full bleed, no transparency (iOS rounds it itself): the tile cropped to its INSIDE, the corners filled from the tile's own gradient.
  - android-icon-foreground.png     1024 x 1024 with transparency: the knight + ring scaled so their ENCLOSING CIRCLE is Android's 66 dp safe circle of the 108 dp adaptive canvas, the rest transparent;
                                    every launcher mask (circle, squircle, teardrop) then shows the artwork whole. The layer behind it is the colour `adaptiveIcon.backgroundColor` (no image).
  - android-icon-monochrome.png     1024 x 1024: ONE shape in the alpha channel (Android 13+ themed icons tint it): the knight and the ring, no colour information.
  - splash-icon.png                 1024 x 1024 with transparency: the knight + ring alone (the splash draws it on `backgroundColor`).
  - favicon.png                     48 x 48: the whole tile, for a browser tab.
Never hand-edit these files; change the source or this script and run it again. `iconAssets.test.ts` pins the sizes, the corner colours and the safe-zone fit.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "brand" / "em-chess-icon-source.png"
OUT = ROOT / "assets"

# The tile colour of the artwork (the median of the tile between the knight and its edge): also `adaptiveIcon.backgroundColor` / the splash `backgroundColor` in app.json (#0a0c0d).
TILE_RGB = (10, 12, 13)
CANVAS = 1024
# Where the dark rounded square sits in the 1254 x 1254 source (measured on its edges): its centre and the side of the square INSIDE it (clear of the curved corners and the edge).
TILE_CENTRE = (627, 630)
TILE_INSIDE = 1000
# The tile's brightness changes from top (lighter) to bottom: the colour near each corner, inside the tile (source pixels).
CORNER_PROBES = {"tl": (242, 245), "tr": (1012, 245), "bl": (242, 1015), "br": (1012, 1015)}
# Android's adaptive icon: a 108 dp canvas, the visible area is at least a 72 dp circle but only the inner 66 dp circle is guaranteed on every launcher.
SAFE_CIRCLE_FRACTION = 66 / 108
# Where the artwork can be in the source: excludes the dark tile's top highlight and its edge.
ARTWORK_BOX = (225, 195, 1030, 1100)  # left, top, right, bottom
LUMINANCE_FLOOR = 30


def load_source():
    image = Image.open(SOURCE).convert("RGB")
    if image.size[0] != image.size[1]:
        sys.exit("the source picture must be square")
    return image


def artwork_mask(rgb):
    """A bool array, True where the pixel belongs to the knight / ring (clearly lighter than the tile), only inside ARTWORK_BOX."""
    array = np.asarray(rgb).astype(np.float64)
    luminance = 0.3 * array[..., 0] + 0.59 * array[..., 1] + 0.11 * array[..., 2]
    mask = luminance > LUMINANCE_FLOOR
    left, top, right, bottom = ARTWORK_BOX
    box = np.zeros_like(mask)
    box[top:bottom, left:right] = True
    return mask & box


def enclosing_circle(mask):
    """Centre and radius of a small circle round the True pixels (Badoiu-Clarkson: step towards the farthest point), 1 % margin."""
    ys, xs = np.nonzero(mask)
    points = np.stack([xs, ys], axis=1).astype(np.float64)[::6]
    centre = points.mean(axis=0)
    for step in range(1, 6000):
        far = points[np.argmax(((points - centre) ** 2).sum(axis=1))]
        centre = centre + (far - centre) / (step + 1)
    radius = float(np.sqrt(((points - centre) ** 2).sum(axis=1).max())) * 1.01
    return centre, radius


def corner_gradient(rgb, size):
    """A bilinear gradient between the tile's four corner colours (what the tile looks like where the crop leaves its curved corners)."""
    array = np.asarray(rgb).astype(np.float64)
    probes = {}
    for name, (x, y) in CORNER_PROBES.items():
        probes[name] = np.median(array[y - 20 : y + 20, x - 20 : x + 20].reshape(-1, 3), axis=0)
    v, u = np.mgrid[0:size, 0:size] / (size - 1)
    u = u[..., None]
    v = v[..., None]
    top = probes["tl"] * (1 - u) + probes["tr"] * u
    bottom = probes["bl"] * (1 - u) + probes["br"] * u
    return Image.fromarray((top * (1 - v) + bottom * v).round().astype(np.uint8), "RGB")


def place(image, centre, scale, size, fill):
    """`image` scaled by `scale` and shifted so `centre` (source pixels) lands in the middle of a `size` canvas; the rest is `fill` (a colour or an image of the canvas size)."""
    scaled = image.resize((round(image.size[0] * scale), round(image.size[1] * scale)), Image.LANCZOS)
    canvas = fill.copy() if isinstance(fill, Image.Image) else Image.new(image.mode, (size, size), fill)
    canvas.paste(scaled, (round(size / 2 - centre[0] * scale), round(size / 2 - centre[1] * scale)))
    return canvas


def soft_disc(size, radius, feather):
    """An L mask, 255 inside `radius`, fading to 0 over `feather` pixels."""
    yy, xx = np.mgrid[0:size, 0:size]
    distance = np.sqrt((xx - size / 2 + 0.5) ** 2 + (yy - size / 2 + 0.5) ** 2)
    alpha = np.clip((radius + feather - distance) / feather, 0.0, 1.0)
    return Image.fromarray((alpha * 255).astype(np.uint8), "L")


def make_icon(rgb):
    """Full bleed: the tile fills the canvas; the crop's corners are filled from the tile's own gradient and blended in."""
    scale = CANVAS / TILE_INSIDE
    background = corner_gradient(rgb, CANVAS)
    canvas = place(rgb, TILE_CENTRE, scale, CANVAS, background)
    half = TILE_INSIDE / 2 * scale
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([CANVAS / 2 - half, CANVAS / 2 - half, CANVAS / 2 + half, CANVAS / 2 + half], radius=half * 0.5, fill=255)
    return Image.composite(canvas, background, mask.filter(ImageFilter.GaussianBlur(14)))


def make_foreground(rgb, centre, radius):
    """The enclosing circle of the artwork == the safe circle (66 / 108 of the canvas); outside it the layer is transparent."""
    safe = SAFE_CIRCLE_FRACTION * CANVAS / 2
    scale = safe / radius
    placed = place(rgb, centre, scale, CANVAS, TILE_RGB)
    image = placed.convert("RGBA")
    image.putalpha(soft_disc(CANVAS, safe * 1.02, CANVAS * 0.035))
    return image


def silhouette_source(rgb):
    """A hole-free alpha shape of the artwork at SOURCE resolution: the knight's grain closed, the dark shading inside it filled, the ring left open."""
    array = np.asarray(rgb).astype(np.float64)
    luminance = 0.3 * array[..., 0] + 0.59 * array[..., 1] + 0.11 * array[..., 2]
    box = np.zeros(luminance.shape, dtype=bool)
    left, top, right, bottom = ARTWORK_BOX
    box[top:bottom, left:right] = True
    # the ring and the bright edges: a clear threshold keeps the glow around them out; the dark knight (low contrast, grainy) is found as the WIDE part of the dim mask
    bright = (luminance > 95) & box
    knight_box = np.zeros(luminance.shape, dtype=bool)
    knight_box[240:1070, 340:900] = True  # the knight only: the glow round the ring is dim too
    dim = Image.fromarray(((luminance > 24) & knight_box).astype(np.uint8) * 255, "L")
    dim = fill_holes(dim.filter(ImageFilter.MaxFilter(25)).filter(ImageFilter.MinFilter(25)))
    body = dim.filter(ImageFilter.MinFilter(41)).filter(ImageFilter.MaxFilter(41))
    mask = Image.fromarray(np.maximum(bright.astype(np.uint8) * 255, np.asarray(body)), "L")
    mask = fill_holes(mask.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(11)))
    return mask.filter(ImageFilter.GaussianBlur(4.0))


def fill_holes(mask):
    """Everything the outside cannot reach becomes 255 (the ring's own gap lets the outside into the ring, so the ring's inside stays empty)."""
    probe = mask.copy()
    ImageDraw.floodfill(probe, (5, 5), 128)
    filled = np.asarray(mask).copy()
    filled[np.asarray(probe) == 0] = 255
    return Image.fromarray(filled, "L")


def make_monochrome(rgb, centre, radius):
    safe = SAFE_CIRCLE_FRACTION * CANVAS / 2
    scale = safe / radius
    alpha = place(silhouette_source(rgb), centre, scale, CANVAS, 0)
    alpha = alpha.point(lambda v: 0 if v < 112 else (255 if v > 144 else int((v - 112) * 255 / 32)))
    image = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 0))
    image.putalpha(alpha)
    return image


def make_splash(rgb, centre, radius):
    """The artwork alone, transparent around it: the splash draws it on its own background colour (the tile colour)."""
    reach = 0.82 * CANVAS / 2
    placed = place(rgb, centre, reach / radius, CANVAS, TILE_RGB)
    image = placed.convert("RGBA")
    image.putalpha(soft_disc(CANVAS, reach * 1.02, CANVAS * 0.04))
    return image


def make_favicon(rgb):
    scale = 48 / TILE_INSIDE
    return place(rgb, TILE_CENTRE, scale, 48, corner_gradient(rgb, 48))


def save(image, name):
    path = OUT / name
    image.save(path, optimize=True)
    print(f"wrote {path.relative_to(ROOT)} {image.size[0]}x{image.size[1]}")


def main():
    rgb = load_source()
    centre, radius = enclosing_circle(artwork_mask(rgb))
    print(f"artwork circle: centre ({centre[0]:.1f}, {centre[1]:.1f}) radius {radius:.1f} of {rgb.size[0]}")
    save(make_icon(rgb), "icon.png")
    save(make_foreground(rgb, centre, radius), "android-icon-foreground.png")
    save(make_monochrome(rgb, centre, radius), "android-icon-monochrome.png")
    save(make_splash(rgb, centre, radius), "splash-icon.png")
    save(make_favicon(rgb), "favicon.png")


if __name__ == "__main__":
    main()
