---
name: build-prod-app
description: >-
  Build the real production desktop app from the current branch and replace
  /Applications/Vide.app with it — no backups, no prompts. Use whenever the
  user says "Prod-App bauen", "App bauen", "build the app", "build the prod
  app", or asks for the fresh app to land in Applications.
---

# Build the prod app and install it into /Applications

"App bauen" means exactly this, every time: the packaged desktop app, built
from whatever branch the request is made on, replacing `/Applications/Vide.app`
in place. Never a backup copy, never a renamed old version, never a question
about which branch — the checkout the user is standing on is the answer.

## Steps

All commands run from the repo root. `vp` lives in `node_modules/.bin` — if it
is not on PATH, prefix with `PATH="$PWD/node_modules/.bin:$PATH"`.

1. **Build the artifact** (long-running — background it and wait):

   ```sh
   vp run dist:desktop:dmg:arm64
   ```

   This is `scripts/build-desktop-artifact.ts`: it builds every workspace
   package, stages a production install, and runs electron-builder. Local
   builds are unsigned by default (`VIDE_DESKTOP_SIGNED=false`) — no Apple
   credentials needed. On an Intel Mac use `dist:desktop:dmg:x64` instead
   (check `uname -m`).

2. **Verify the artifacts** — the build leaves only the DMG and the update ZIP
   in `release/` (no unpacked `.app` directory survives):

   ```sh
   ls release/Vide-*-arm64.zip release/Vide-*-arm64.dmg
   ```

   The ZIP contains exactly `Vide.app` and is what gets installed — no DMG
   mounting needed. Check its timestamp: an old artifact from a previous build
   sits in the same folder under the same version number.

3. **Replace it in /Applications** — remove, then extract the ZIP with `ditto`
   (preserves the bundle's metadata and ad-hoc signature; plain `unzip` does
   not reliably):

   ```sh
   rm -rf /Applications/Vide.app
   ditto -x -k release/Vide-<version>-arm64.zip /Applications/
   ```

   Do not force-quit a running Vide to do this: macOS keeps the old process
   alive on its open files, the replacement still lands cleanly, and the fresh
   build is picked up on the user's next launch.

4. Report the installed version (`plutil -extract CFBundleShortVersionString
raw /Applications/Vide.app/Contents/Info.plist`), the binary's timestamp,
   and the branch it was built from. If Vide was running during the swap, say
   that the fresh build takes over on the next launch.

## Failure modes

- `vp` missing / no `node_modules`: run `corepack pnpm install` first.
- Build fails in the staging phase mentioning pnpm builds or patches: the
  workspace changed under it — reinstall, then rebuild.
- `rm -rf /Applications/Vide.app` fails with "Operation not permitted": the
  app is still running or Finder holds it — quit it (step 3) and retry.
