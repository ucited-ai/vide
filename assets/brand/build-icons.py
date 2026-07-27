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

    <linearGradient id="field" x1="0.12" y1="0" x2="0.72" y2="1">
      <stop offset="0%" stop-color="{c_top}" />
      <stop offset="48%" stop-color="{c_mid}" />
      <stop offset="100%" stop-color="{c_bottom}" />
    </linearGradient>

    <!-- Specular sweep: what separates glass from flat plastic -->
    <linearGradient id="specular" x1="0.1" y1="0" x2="0.32" y2="0.92">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.34" />
      <stop offset="38%" stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>

    <radialGradient id="bloom" cx="0.26" cy="0.10" r="0.78">
      <stop offset="0%" stop-color="{c_bloom}" stop-opacity="0.42" />
      <stop offset="60%" stop-color="{c_bloom}" stop-opacity="0" />
    </radialGradient>

    <!-- One stroke, one gradient: the light shifts across the vertex instead of
         two arms overlapping and bruising the join. -->
    <linearGradient id="markFill" x1="0" y1="0.1" x2="1" y2="0.9">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1" />
      <stop offset="46%" stop-color="#FFFFFF" stop-opacity="0.97" />
      <stop offset="54%" stop-color="#FFFFFF" stop-opacity="0.80" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.66" />
    </linearGradient>

    <linearGradient id="rim" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.50" />
      <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.14" />
    </linearGradient>

    <filter id="markShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="{c_shadow}" flood-opacity="0.30" />
    </filter>
  </defs>

  <g clip-path="url(#clip)">
    <use href="#squircle" fill="url(#field)" />
    <use href="#squircle" fill="url(#bloom)" />
    <use href="#squircle" fill="url(#specular)" />
  </g>

  <!-- The V is an angle bracket turned a quarter turn: Vide reads as a letter,
       a chevron, and a code delimiter at the same time. -->
  <path d="M 349 379 L 512 645 L 675 379"
        fill="none" stroke="url(#markFill)" stroke-width="96"
        stroke-linecap="round" stroke-linejoin="round"
        filter="url(#markShadow)" />

  <!-- Apple draws a hairline separator around every glass surface -->
  <use href="#squircle" fill="none" stroke="url(#rim)" stroke-width="2.5" />
</svg>
"""

VARIANTS = {
    "prod": dict(c_top="#8B7BFF", c_mid="#5A46E8", c_bottom="#291A78",
                 c_bloom="#D4CCFF", c_shadow="#150C4A"),
    "dev": dict(c_top="#5AC8F5", c_mid="#1E82D8", c_bottom="#0B3A78",
                c_bloom="#C4E8FF", c_shadow="#062544"),
    "nightly": dict(c_top="#4A4A55", c_mid="#26262E", c_bottom="#0A0A0C",
                    c_bloom="#B9B9CC", c_shadow="#000000"),
}


def render_svg(variant: str) -> str:
    return SVG_TEMPLATE.format(
        squircle=squircle_path(CANVAS / 2, CANVAS / 2, SIDE / 2, SUPERELLIPSE_N),
        **VARIANTS[variant],
    )


def png_bytes(svg: str, size: int) -> bytes:
    return cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)


# --- .ico ------------------------------------------------------------------
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def write_ico(svg: str, dest: Path) -> None:
    images = [(s, png_bytes(svg, s)) for s in ICO_SIZES]
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


def write_icns(svg: str, dest: Path, workdir: Path) -> None:
    iconset = workdir / "vide.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    for size, name in ICNS_SET:
        (iconset / f"icon_{name}.png").write_bytes(png_bytes(svg, size))
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dest)], check=True)


def main() -> None:
    preview_only = "--preview-only" in sys.argv
    scratch = Path("/private/tmp/claude-501/-Users-henri-Desktop-Desktop-Privat-Tools-vIDE"
                   "/ed7ab12c-887b-44f7-a07d-7e93829190e4/scratchpad")

    prod_svg = render_svg("prod")
    SVG_PATH.write_text(prod_svg, encoding="utf-8")

    if preview_only:
        for size in (1024, 128, 32):
            (scratch / f"preview-{size}.png").write_bytes(png_bytes(prod_svg, size))
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
        for name, size in files:
            (outdir / name).write_bytes(png_bytes(svg, size))
            written.append(f"assets/{variant}/{name}")
        for name in ico_targets[variant]:
            write_ico(svg, outdir / name)
            written.append(f"assets/{variant}/{name}")

    # Electron packaging resources
    resources = ROOT / "apps" / "desktop" / "resources"
    (resources / "icon.png").write_bytes(png_bytes(prod_svg, 1024))
    write_ico(prod_svg, resources / "icon.ico")
    write_icns(prod_svg, resources / "icon.icns", scratch)
    written += ["apps/desktop/resources/icon.png", "apps/desktop/resources/icon.ico",
                "apps/desktop/resources/icon.icns"]

    # Web favicons served by apps/web
    web_public = ROOT / "apps" / "web" / "public"
    if web_public.is_dir():
        (web_public / "favicon-16x16.png").write_bytes(png_bytes(prod_svg, 16))
        (web_public / "favicon-32x32.png").write_bytes(png_bytes(prod_svg, 32))
        (web_public / "apple-touch-icon.png").write_bytes(png_bytes(prod_svg, 180))
        write_ico(prod_svg, web_public / "favicon.ico")
        written += [f"apps/web/public/{n}" for n in
                    ("favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "favicon.ico")]

    for path in written:
        print(f"  {path}")
    print(f"\n{len(written)} assets written from {SVG_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
