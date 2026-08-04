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

2. **Verify the staged app exists** — electron-builder leaves the unpacked
   bundle next to the DMG:

   ```sh
   ls -d release/mac-arm64/Vide.app
   ```

   (The DMG lands in `release/Vide-<version>-arm64.dmg`; the `.app` is what
   gets installed. A nightly-channel version builds as "Vide (Nightly).app" —
   install whatever `release/mac-arm64/` actually contains.)

3. **Quit the running app, if any** (a busy bundle cannot be replaced
   cleanly):

   ```sh
   osascript -e 'tell application "Vide" to quit' 2>/dev/null; sleep 2
   ```

4. **Replace it in /Applications** — remove, then copy with `ditto` (preserves
   the bundle's metadata and ad-hoc signature; `cp -R` does not reliably):

   ```sh
   rm -rf /Applications/Vide.app
   ditto release/mac-arm64/Vide.app /Applications/Vide.app
   ```

5. **Relaunch** so the user lands in the fresh build:

   ```sh
   open /Applications/Vide.app
   ```

6. Report the installed version (`plutil -extract CFBundleShortVersionString
raw /Applications/Vide.app/Contents/Info.plist`) and the branch it was
   built from.

## Failure modes

- `vp` missing / no `node_modules`: run `corepack pnpm install` first.
- Build fails in the staging phase mentioning pnpm builds or patches: the
  workspace changed under it — reinstall, then rebuild.
- `rm -rf /Applications/Vide.app` fails with "Operation not permitted": the
  app is still running or Finder holds it — quit it (step 3) and retry.
