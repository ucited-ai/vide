# CLAUDE.md

The one file agents read. `AGENTS.md` points here.

## Packages

- `apps/server` — Node WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the
  built web app, manages provider sessions.
- `apps/web` — React/Vite UI. Owns session UX, conversation and event rendering, client state.
  Talks to the server over WebSocket.
- `apps/desktop` — Electron shell around the same web app, plus native IPC (dialogs, context menus,
  client-settings persistence, updates).
- `packages/contracts` — Shared effect/Schema schemas for provider events, the WebSocket protocol,
  model and session types. Schema-only: no runtime logic.
- `packages/shared` — Runtime utilities used by server and clients. Explicit subpath exports
  (`@vide/shared/git`), no barrel index.
- `packages/client-runtime` — Client code shared across web and mobile.

## Running it

`vp run <script>`; every script is in the root `package.json`.

|                                 |                                             |
| ------------------------------- | ------------------------------------------- |
| `vp run dev`                    | server + web, in a browser                  |
| `vp run dev --share`            | same, reachable from another tailnet device |
| `vp run dev:desktop`            | server + web + the Electron window          |
| `vp run dev:server` / `dev:web` | one half only                               |

All four are `node scripts/dev-runner.ts <mode>`. The runner picks ports from a hash of the worktree
path and shifts them when one is taken, so **read the actual ports from its `[dev-runner]` line**
rather than assuming.

State lives in `baseDir`, also on that line. In a linked worktree it defaults to that worktree's
gitignored `.vide` — deliberately outranking an ambient `VIDE_HOME`, which would otherwise point at
the installed app's live database. `--home-dir` still wins.

Browser dev is single-origin: Vite proxies `/api`, `/ws`, `/oauth` and `/.well-known` to the
backend. Do not set `VITE_HTTP_URL` or `VITE_WS_URL` for `dev` or `dev:web`.

The app requires pairing on first load. The runner prints a one-time `…/pair#token=…` URL; it is
single-use, so opening it twice consumes it. Mint another with
`node apps/server/src/bin.ts auth pairing create --base-dir <dir> --dev-url <web-url> --base-url <web-url>`,
with `VIDE_PORT` set to the running server's port.

## Building it

|                                                 |                       |
| ----------------------------------------------- | --------------------- |
| `vp run build`                                  | every app and package |
| `vp run build:desktop`                          | the Electron app      |
| `vp run dist:desktop:dmg` \| `:win` \| `:linux` | installers            |
| `vp run start` / `start:desktop`                | run what was built    |

## Verifying a change

Keep verification to what the change touched. **CI owns the full suite** — do not run repo-wide
`vp check`, `vp run typecheck`, or `vp run test` locally unless asked.

- Tests: `vp test run <files>`, from the package directory. Run from the repo root, the glob also
  reaches any git worktree under `.claude/worktrees/`, and its stale copy of a file reports as a
  phantom failure.
- Types: `npx tsgo --noEmit` in the affected package.
- Lint and format: `vp lint <files>`, `vp fmt <files>`.
- Backend changes need focused tests for the changed behaviour.

Committing runs formatting and a **dead-code gate**. It blocks on a newly exported symbol nothing
references; a symbol only a test references is a note, not a block. Delete the symbol rather than
updating the baseline.

**A claim about how something looks is worth nothing unless something actually looked at it** —
say plainly when a visual check has not happened. Do not start dev servers or drive browsers for
verification unless the user asks for it.

## Reference material

`.repos/` vendors external repositories, read-only. Prefer their real source over a guess or a web
search. Do not edit them and do not import from them; application code imports from normal
dependencies. Sync with `vpr sync:repos`, and sync a subtree in the same change that bumps its
dependency.

- Effect: read `.repos/effect-smol/LLMS.md` first, then the examples and tests there.
- Relay infrastructure with Alchemy: `.repos/alchemy-effect/`.
- Codex, upstream: https://github.com/openai/codex
