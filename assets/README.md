# Brand assets

Everything here is generated. The single source of truth is `brand/vide-mark.svg`.

```bash
vp run icons        # or: python3 assets/brand/build-icons.py
```

`build-icons.py` renders three channel variants (`prod` violet, `dev` blue, `nightly`
graphite) into the PNG/ICO sizes that `scripts/lib/brand-assets.ts` expects, writes the
Electron packaging resources in `apps/desktop/resources`, and refreshes the web favicons in
`apps/web/public`.

To restyle the app icon, edit the SVG and re-run. Do not hand-edit the generated files.

The squircle is a sampled superellipse rather than a rounded rectangle — that continuous
curvature is what makes the silhouette read as an Apple app icon.
