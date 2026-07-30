#!/usr/bin/env python3
"""Generate every Vide brand asset from one SVG source.

Apple's app-icon silhouette is a superellipse, not a rounded rectangle. Sampling
|x/a|^n + |y/a|^n = 1 gives the continuous curvature that a plain `rx` cannot,
which is why the squircle path is generated here rather than hand-authored.

Usage: python3 assets/brand/build-icons.py [--preview-only]
"""

import struct
import subprocess
import sys
import zlib
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "assets" / "brand"
SVG_PATH = BRAND / "vide-mark.svg"

CANVAS = 1024
INSET = 100                      # macOS icons float inside their canvas
SIDE = CANVAS - 2 * INSET        # 824
SUPERELLIPSE_N = 4.85            # matches Apple's continuous corner curvature


def squircle_path(cx: float, cy: float, half: float, n: float, samples: int = 360) -> str:
    """Superellipse as an SVG path, sampled densely enough to look analytic."""
    import math

    points = []
    for i in range(samples):
        theta = 2.0 * math.pi * i / samples
        ct, st = math.cos(theta), math.sin(theta)
        x = cx + half * math.copysign(abs(ct) ** (2.0 / n), ct)
        y = cy + half * math.copysign(abs(st) ** (2.0 / n), st)
        points.append(f"{x:.2f} {y:.2f}")
    return "M " + " L ".join(points) + " Z"


SVG_TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Vide">
  <title>Vide</title>
  <defs>
    <path id="squircle" d="{squircle}" />
    <clipPath id="clip"><use href="#squircle" /></clipPath>

    <linearGradient id="field" x1="0.15" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="{c_top}" />
      <stop offset="52%" stop-color="{c_mid}" />
      <stop offset="100%" stop-color="{c_bottom}" />
    </linearGradient>

    <!-- Light falling from the top-left, the way it does on a physical object -->
    <radialGradient id="sheen" cx="0.3" cy="0.08" r="0.85">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10" />
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>

    <!--
      The mark is machined, not printed: a bright rim catches the light and the
      face inside it stays dark. Two strokes of the same path do this more
      cleanly than a bevel filter, and they survive being scaled to 16px.
    -->
    <linearGradient id="rim" x1="0.1" y1="0" x2="0.75" y2="1">
      <stop offset="0%" stop-color="#f2f2f2" />
      <stop offset="45%" stop-color="#9a9a9a" />
      <stop offset="100%" stop-color="#4a4a4a" />
    </linearGradient>

    <linearGradient id="face" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="{c_face_top}" />
      <stop offset="100%" stop-color="{c_face_bottom}" />
    </linearGradient>

    <linearGradient id="edge" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.09" />
    </linearGradient>

    <!--
      Grain. Renders in any browser, but cairosvg ignores feTurbulence, so
      build-icons.py adds a matching grain to the raster exports instead. Both
      paths are covered; neither is the only one.
    -->
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="7" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
  </defs>

  <g clip-path="url(#clip)">
    <use href="#squircle" fill="url(#field)" />
    <use href="#squircle" fill="url(#sheen)" />
    <rect width="1024" height="1024" filter="url(#grain)" opacity="{grain_opacity}"
          style="mix-blend-mode:overlay" />
  </g>

  <!--
    The V is an angle bracket turned a quarter turn, so it reads as a letter and
    as a code delimiter at once. The rules beside it are lines of code sitting in
    the space the letter opens up.
  -->
  <g clip-path="url(#clip)">
    <path d="M 349 379 L 512 645 L 675 379" fill="none" stroke="url(#rim)"
          stroke-width="106" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 349 379 L 512 645 L 675 379" fill="none" stroke="url(#face)"
          stroke-width="88" stroke-linecap="round" stroke-linejoin="round" />

    <g fill="url(#rim)">
      <rect x="516" y="416" width="72" height="17" rx="8.5" />
      <rect x="516" y="453" width="52" height="17" rx="8.5" />
      <rect x="516" y="490" width="32" height="17" rx="8.5" />
    </g>
  </g>

  <!-- Apple draws a hairline separator around every icon of this kind -->
  <use href="#squircle" fill="none" stroke="url(#edge)" stroke-width="2.5" />
</svg>
"""

# Monochrome throughout — the app's own palette has no hue in it, and an icon
# that introduces one would be the loudest thing on the dock. The three channels
# separate by luminance instead, which still tells them apart at 16px.
VARIANTS = {
    "prod": dict(c_top="#2b2b2b", c_mid="#1c1c1c", c_bottom="#101010",
                 c_face_top="#5a5a5a", c_face_bottom="#232323", grain_opacity="0.14"),
    "dev": dict(c_top="#484848", c_mid="#343434", c_bottom="#222222",
                c_face_top="#767676", c_face_bottom="#3a3a3a", grain_opacity="0.16"),
    "nightly": dict(c_top="#141414", c_mid="#0b0b0b", c_bottom="#000000",
                    c_face_top="#3e3e3e", c_face_bottom="#141414", grain_opacity="0.12"),
}

# Grain strength per channel, matched to the SVG's own filter opacity above.
GRAIN_BY_VARIANT = {"prod": 0.14, "dev": 0.16, "nightly": 0.12}


def render_svg(variant: str) -> str:
    return SVG_TEMPLATE.format(
        squircle=squircle_path(CANVAS / 2, CANVAS / 2, SIDE / 2, SUPERELLIPSE_N),
        **VARIANTS[variant],
    )


def png_bytes(svg: str, size: int, grain: float = 0.0) -> bytes:
    """Rasterise, adding the grain the SVG filter describes.

    cairosvg silently ignores feTurbulence, so an icon exported through it would
    come out perfectly flat while the same SVG in a browser is textured. The noise
    is therefore reapplied here, deterministically, so both paths agree.

    Below 64px it is skipped: at that size grain is indistinguishable from
    compression artefacts and only makes the silhouette read as dirty.
    """
    raw = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    if grain <= 0 or size < 64:
        return raw

    import io

    import numpy as np
    from PIL import Image

    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    pixels = np.asarray(image, dtype=np.int16)

    # Grain is generated on a fixed grid and resampled, so a speck covers the same
    # fraction of the icon at every export size. Per-pixel noise instead gets
    # finer as the icon grows, which made 128px look sandblasted next to 1024px.
    #
    # Amplitude also tapers with size: at dock scale grain reads as dirt rather
    # than texture, and the silhouette matters more than the surface.
    grid = 256
    amplitude = 255.0 * grain * 0.22 * min(1.0, max(0.35, size / 512))
    # Seeded, so a rebuild produces byte-identical icons rather than churn.
    field = np.random.default_rng(7).normal(0.0, amplitude, (grid, grid))
    if size != grid:
        field = np.asarray(
            Image.fromarray(field.astype(np.float32), mode="F").resize(
                (size, size), Image.BILINEAR
            ),
            dtype=np.float64,
        )
    noise = field[:, :, None]
    alpha = pixels[:, :, 3]
    # Only inside the silhouette. Transparent pixels still carry RGB that survives
    # scaling and compositing, so noising them speckles the corners.
    inside = (alpha > 0)[:, :, None]
    rgb = np.where(inside, np.clip(pixels[:, :, :3] + noise, 0, 255), pixels[:, :, :3])
    # Alpha is never touched, so the squircle keeps a clean edge.
    out = np.dstack([rgb.astype(np.uint8), alpha.astype(np.uint8)])
    buffer = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


# --- .ico ------------------------------------------------------------------
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def write_ico(svg: str, dest: Path, grain: float = 0.0) -> None:
    images = [(s, png_bytes(svg, s, grain)) for s in ICO_SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    entries, blobs = b"", b""
    offset = len(header) + 16 * len(images)
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    dest.write_bytes(header + entries + blobs)


# --- .icns via iconutil ----------------------------------------------------
ICNS_SET = [(16, "16x16"), (32, "16x16@2x"), (32, "32x32"), (64, "32x32@2x"),
            (128, "128x128"), (256, "128x128@2x"), (256, "256x256"),
            (512, "256x256@2x"), (512, "512x512"), (1024, "512x512@2x")]


def write_icns(svg: str, dest: Path, workdir: Path, grain: float = 0.0) -> None:
    iconset = workdir / "vide.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    for size, name in ICNS_SET:
        (iconset / f"icon_{name}.png").write_bytes(png_bytes(svg, size, grain))
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dest)], check=True)


def main() -> None:
    preview_only = "--preview-only" in sys.argv
    scratch = Path("/private/tmp/claude-501/-Users-henri-Desktop-Desktop-Privat-Tools-vIDE"
                   "/ed7ab12c-887b-44f7-a07d-7e93829190e4/scratchpad")

    prod_svg = render_svg("prod")
    SVG_PATH.write_text(prod_svg, encoding="utf-8")

    if preview_only:
        for size in (1024, 128, 32):
            (scratch / f"preview-{size}.png").write_bytes(png_bytes(prod_svg, size, GRAIN_BY_VARIANT["prod"]))
        print("preview written")
        return

    written = []

    # Channel icon sets consumed by scripts/lib/brand-assets.ts
    targets = {
        "prod": [("black-ios-1024.png", 1024), ("black-macos-1024.png", 1024),
                 ("black-universal-1024.png", 1024),
                 ("vide-black-web-apple-touch-180.png", 180),
                 ("vide-black-web-favicon-16x16.png", 16),
                 ("vide-black-web-favicon-32x32.png", 32)],
        "dev": [("blueprint-ios-1024.png", 1024), ("blueprint-macos-1024.png", 1024),
                ("blueprint-universal-1024.png", 1024),
                ("blueprint-web-apple-touch-180.png", 180),
                ("blueprint-web-favicon-16x16.png", 16),
                ("blueprint-web-favicon-32x32.png", 32)],
        "nightly": [("nightly-ios-1024.png", 1024), ("nightly-macos-1024.png", 1024),
                    ("nightly-universal-1024.png", 1024),
                    ("nightly-web-apple-touch-180.png", 180),
                    ("nightly-web-favicon-16x16.png", 16),
                    ("nightly-web-favicon-32x32.png", 32)],
    }
    ico_targets = {"prod": ["vide-black-windows.ico", "vide-black-web-favicon.ico"],
                   "dev": ["blueprint-windows.ico", "blueprint-web-favicon.ico"],
                   "nightly": ["nightly-windows.ico", "nightly-web-favicon.ico"]}

    for variant, files in targets.items():
        svg = render_svg(variant)
        outdir = ROOT / "assets" / variant
        outdir.mkdir(parents=True, exist_ok=True)
        grain = GRAIN_BY_VARIANT[variant]
        for name, size in files:
            (outdir / name).write_bytes(png_bytes(svg, size, grain))
            written.append(f"assets/{variant}/{name}")
        for name in ico_targets[variant]:
            write_ico(svg, outdir / name, grain)
            written.append(f"assets/{variant}/{name}")

    # Electron packaging resources
    resources = ROOT / "apps" / "desktop" / "resources"
    (resources / "icon.png").write_bytes(png_bytes(prod_svg, 1024, GRAIN_BY_VARIANT["prod"]))
    write_ico(prod_svg, resources / "icon.ico", GRAIN_BY_VARIANT["prod"])
    write_icns(prod_svg, resources / "icon.icns", scratch, GRAIN_BY_VARIANT["prod"])
    written += ["apps/desktop/resources/icon.png", "apps/desktop/resources/icon.ico",
                "apps/desktop/resources/icon.icns"]

    # Web favicons served by apps/web
    web_public = ROOT / "apps" / "web" / "public"
    if web_public.is_dir():
        (web_public / "favicon-16x16.png").write_bytes(png_bytes(prod_svg, 16, GRAIN_BY_VARIANT["prod"]))
        (web_public / "favicon-32x32.png").write_bytes(png_bytes(prod_svg, 32, GRAIN_BY_VARIANT["prod"]))
        (web_public / "apple-touch-icon.png").write_bytes(png_bytes(prod_svg, 180, GRAIN_BY_VARIANT["prod"]))
        write_ico(prod_svg, web_public / "favicon.ico", GRAIN_BY_VARIANT["prod"])
        written += [f"apps/web/public/{n}" for n in
                    ("favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "favicon.ico")]

    for path in written:
        print(f"  {path}")
    print(f"\n{len(written)} assets written from {SVG_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
