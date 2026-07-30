# Vide

A native-feeling macOS GUI for coding agents — Claude Code, Codex, Cursor, and OpenCode.

_Vibe coding + IDE._ Personal build, maintained for one machine.

---

## What this is

A customized fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT), rebuilt around a
single goal: an app that feels like it belongs on macOS rather than a web page in a window.

Everything mobile, marketing, and vendored-reference has been stripped out. What remains:

| Path           | What it does                                             |
| -------------- | -------------------------------------------------------- |
| `apps/web`     | The UI — React 19, Tailwind v4, TanStack Router, Base UI |
| `apps/desktop` | The Electron shell that turns it into `Vide.app`         |
| `apps/server`  | Backend + the `vide` CLI; talks to the agent providers   |
| `packages/*`   | Shared contracts, runtime, SSH, Tailscale                |
| `assets/brand` | `vide-mark.svg` — the single source for every icon       |

## Requirements

- **Node 24.13.1+** (`nvm install 24`)
- **Vite+** — `curl -fsSL https://vite.plus | bash`
- At least one authenticated agent CLI: `claude`, `codex`, `cursor-agent`, or `opencode`

## Working on it

```bash
vp i                    # install dependencies
vp run dev:desktop      # Electron with hot reload — the customization loop
vp run tc               # typecheck
vp run test             # tests
```

## Building the real app

```bash
vp run dist:desktop:dmg:arm64    # -> Vide.app + .dmg
```

Local builds carry no update feed, so the app never replaces itself. Its bundle id is
`com.vide.app` and its state lives in `~/.vide`, both distinct from upstream's — an official
T3 Code install can sit alongside this one without either touching the other's data.

## Icons

Every icon derives from one file. Edit `assets/brand/vide-mark.svg`, then:

```bash
vp run icons
```

That regenerates all PNG/ICO/ICNS variants across the three channels, the Electron packaging
resources, and the web favicons. Upstream's Icon Composer pipeline was removed — it required
Xcode 26 and produced upstream's mark.

## Tracking upstream

```bash
git fetch upstream
git merge upstream/main
```

Conflicts appear only in files this fork has touched. Customizations therefore prefer _new_
files (own components, own theme layer) over edits to upstream files wherever that is possible.

Deleted directories (`apps/mobile`, `apps/marketing`, `.repos`, `.github/workflows`) will show
up as modify/delete conflicts if upstream changes them — resolve by keeping them deleted:

```bash
git rm -r <path>
```

Anything removed is recoverable: `git checkout upstream/main -- <path>`.

## Attribution

Built on [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., MIT licensed.
The original copyright notice is retained in [LICENSE](./LICENSE), as that license requires.
