# Dead-code check — design

A pre-commit gate that reports dead code, blocks only on dead code **this commit created**, and
attributes each finding to the commit that orphaned it plus how long it has been dead.

Every number below is measured on this repo (2181 commits, 1682 tracked `.ts/.tsx/.css/.js/.jsx`
files outside `.repos/`, ~18 MB of source), on this machine, with Node 24.18.

---

## 1. The knip verdict, first

**knip is the right tool for two of the six things "dead" means here, and it should be a CI job, not
a hook. I am not adding it now.** Concretely:

|                                        | knip                                    | this check                   |
| -------------------------------------- | --------------------------------------- | ---------------------------- |
| unused exports                         | yes, resolver-accurate                  | yes, textual (under-reports) |
| unused files / orphan modules          | **yes — its best feature**              | no                           |
| unused dependencies                    | **yes**                                 | no                           |
| unused CSS custom properties           | **no**                                  | yes                          |
| unused `.vide-*` utilities             | **no**                                  | yes                          |
| test-only exports                      | partially (`--include exports` + tags)  | yes                          |
| delta vs. baseline on staged files     | no — always whole-graph                 | yes, that is the point       |
| attribution (which commit orphaned it) | no                                      | yes                          |
| runtime                                | whole-program TS graph, tens of seconds | **0.5 s**                    |

Costs of adopting knip here, honestly:

- **Config burden is the real price, not install size.** Eleven workspaces (`apps/{web,server,desktop}`,
  `packages/{contracts,shared,client-runtime,effect-acp,effect-codex-app-server,ssh,tailscale}`,
  `infra/relay`, `scripts`, `oxlint-plugin-vide`), each needing `entry`/`project` globs. The build
  system is `vite-plus` (`vp run`), which knip has no plugin for, so its entry inference —
  the thing that makes knip cheap on a Next.js app — does not apply. Electron main/preload,
  the MSW service worker (`apps/web/public/mockServiceWorker.js`, wired through the root
  `package.json` `msw.workerDirectory`), and `patches/` all need manual entries.
- **False-positive rate on this codebase is high until tuned.** A pure name-reference count over the
  whole repo yields **3199** unused exports, **1617 of them in `packages/effect-codex-app-server`
  alone** and 360 in `packages/contracts` — both are deliberately exhaustive bindings for an external
  protocol, where a complete surface is the charter (AGENTS.md: "Keep this package schema-only").
  knip would report the same order of magnitude until per-workspace `ignore`/`ignoreExportsUsedInFile`
  were tuned. That tuning is a project, and it is a project that has to be re-done whenever a
  workspace is added.
- **It cannot see the CSS half of the question at all.** Custom properties in
  `apps/web/src/vide-theme.css` and `.vide-*` utilities are invisible to knip. That is half of what
  was asked for, and it is the half where this repo has real, verifiable findings today
  (`--surface-raised-2` and `--ease-in-out` are declared and never referenced).
- **Runtime rules it out of a hook.** knip builds a TypeScript program. On ~1700 files that is tens
  of seconds. A hook that costs that much gets `--no-verify`'d, which is exactly the failure mode this
  task exists to avoid. It would have to be `--all`-mode / CI-only anyway.

So: **build the delta+CSS+attribution check now** (it is ~600 lines including tests and covers the
pre-commit case knip structurally cannot); **recommend knip later as a weekly CI job** scoped to
unused _files_ and unused _dependencies_, the two things it does that nothing here does.

Equally: I am **not** writing an oxlint rule for this. oxlint JS plugins are per-file with no
cross-file resolution, so a rule could only either duplicate `eslint(no-unused-vars)` — already
enabled by the `correctness` category in `vite.config.ts`, and already the thing that reports the four
dead `ChatView.tsx` functions — or fail to see the references it needs. The right move is to _consume_
oxlint's JSON output for the file-local channel rather than reimplement it worse.

---

## 2. What "dead" means in this repo

Six kinds. They do not all deserve the same treatment, which is most of the design.

| kind                    | definition                                                                                                        | severity     | why                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unused-local`          | declared, never referenced in its own file. Taken verbatim from `oxlint`'s `eslint(no-unused-vars)`.              | **blocks**   | AST-accurate, zero false positives. This is the channel that finds `saveProjectScript`, `updateProjectScript`, `deleteProjectScript`, `lastInvokedScriptByProjectId`.                             |
| `unused-export` (value) | `export const/let/var/function/class/enum/namespace X` with no textual reference to `X` in any other tracked file | **blocks**   | an unused exported _value_ is shipped code: it is in the bundle, it is type-checked, it is maintained                                                                                             |
| `unused-export` (type)  | `export type/interface X`, same test                                                                              | reports only | zero runtime and zero bundle cost, and in this codebase an exported type is often the deliberate public shape of a module. 147 of them in `apps/web/src` alone — blocking on these would be noise |
| `test-only-export`      | referenced outside its file, but only from `*.test.ts(x)` / `*.spec.ts(x)`                                        | reports only | dead code wearing a disguise — but also a legitimate pattern (a seam opened deliberately for a test). Worth naming, not worth blocking                                                            |
| `unused-css-var`        | `--name:` declared in an owned CSS file, no `--name` token anywhere in the repo                                   | **blocks**   | validated: 59 declared outside `@theme` in `vide-theme.css`, exactly 2 unused, both genuine                                                                                                       |
| `unused-css-class`      | `.vide-*` selector declared, class token never referenced                                                         | **blocks**   | namespaced by convention, so ownership is unambiguous                                                                                                                                             |

### Scope

Declarations are scanned in first-party application and library code only:
`apps/{web,server,desktop}/src`, `packages/{shared,client-runtime}/src`, `scripts`,
`oxlint-plugin-vide`. **References are counted across the entire repo** — including the excluded
packages, and including `.json` and `.html` because those carry real wiring (script tags, `bin` and
`scripts` entries). Narrowing the reference side would create false positives, and false positives in
a blocking hook are the one thing that must not happen.

Two things are nonetheless excluded from the **reference** side, both learned the hard way while
building this:

- **`*.md`.** A name mentioned in prose is not a reference. With markdown included, this very design
  document — which names several dead symbols — resurrected them and emptied out its own findings.
- **`scripts/dead-code/baseline.json`.** The ledger lists every finding by name. Scanning it kept the
  entire ledger alive, and one run reported all 1797 entries as simultaneously fixed.

The general shape of that hazard is worth stating: **a comment is an occurrence, and a test fixture is
an occurrence.** Naming a real symbol in this checker's own source or tests silently deletes a genuine
finding. It happened three times during development (`--surface-raised-2` masked by the token-regex
comment, then by a test fixture; `--ease-in-out` masked by a comment about `.repos/`). Every example
name in `scripts/dead-code/**` is therefore invented, and both facts are commented at the sites.

Excluded from declaration scanning, with reasons:

- `packages/contracts`, `packages/effect-acp`, `packages/effect-codex-app-server` — exhaustive
  external-protocol bindings; a complete surface is the point (1617 + 360 + 127 "findings" of pure
  noise if included).
- `packages/ssh`, `packages/tailscale`, `infra/relay` — thin adapters with the same property.
- `*.d.ts`, `*.test.ts(x)`, `*.spec.ts(x)`, `**/test/**`, `**/__mocks__/**` — a test helper's exports
  exist for tests by definition (this is why `oxlint-plugin-vide/test/utils.ts` is not a finding).
- `.repos/**` — vendored read-only reference material.

CSS is scanned in `apps/web/src/vide-theme.css` only, plus any CSS file passed explicitly. Not
`index.css`: it is upstream's, and most of what it declares is consumed by Tailwind codegen or by
library-rendered DOM (CodeMirror, shiki, markdown) rather than by our source.

---

## 3. How it detects, inside the runtime budget

One pass, no program graph:

1. `git ls-files` over text source extensions, minus `.repos/` and the lockfile.
2. Read every file. Unreadable files are skipped, not fatal — this repo contains a **committed broken
   symlink** (`CLAUDE.md` → `AGENTS.md\n`, with a literal trailing newline in the link target) which
   makes a naive `readFileSync` loop crash on file 68.
3. Build **one inverted index**: token → set of file ids. The token pattern matches JS identifiers and
   CSS custom-property names in the same scan.
4. Extract exported declarations from in-scope files by regex.
5. A symbol is **alive** if the index maps its name to any file other than its own declaring file(s).
6. `vp lint --format json <staged .ts/.tsx>` for the `unused-local` channel.

Measured, repo-wide:

```
git ls-files    13 ms
read 1770 files 271 ms
token index     206 ms   (46 878 distinct tokens, 172 MB RSS)
extract exports  21 ms   (11 441 declarations)
analyse          14 ms
--------------------------------
total           513 ms
```

`vp lint --format json` on one staged file: **0.60 s** (dominated by oxlint's JS-plugin startup).
Repo-wide `vp lint` is 2.57 s, which is why the hook lints **only the staged files** — that is also
exactly the delta semantics we want.

Two candidate strategies were measured. A per-candidate `String.includes()` prefilter costs 126 ms for
30 candidates and scales linearly with the candidate count; the inverted index costs 206 ms once and
is then O(1) per candidate. The index wins outright at 11 441 declarations, so there is no need to
make the whole-repo mode opt-in. **Nothing in the default hook path is opt-in except attribution.**

End to end, on a 15-file staged change of which 11 are lintable (three consecutive runs):

```
dead-code check          594 / 604 / 604 ms      (250-300 ms of that is the scan; the rest is oxlint)
whole pre-commit hook   1.44 / 1.53 / 1.58 s     (vp staged + the check)
```

A commit with no lintable files staged — a docs or asset commit — costs **250-300 ms**, because the
oxlint pass is skipped entirely.

### Why textual and not a real graph

Because 0.5 s versus tens of seconds decides whether the hook survives. The trade is deliberate and
the bias is deliberate: **any** occurrence of the name anywhere — in a string, a comment, a
`.md`, a `.json` — keeps the symbol alive. The check therefore **under-reports** and never blocks a
commit over a symbol that is referenced in a way it does not model. See §7 for what that costs.

---

## 4. Baseline: where it lives, how it refreshes, what happens when it drifts

`scripts/dead-code/baseline.json`, committed.

```json
{
  "version": 1,
  "generatedAt": "2026-07-30",
  "findings": {
    "unused-export:apps/web/src/components/SplashScreen.tsx:SplashScreen": "2026-07-30"
  }
}
```

- **Key is `kind:path:symbol`. No line numbers, ever.** A line number would make the baseline churn on
  every reformat and on every edit above a symbol, and a baseline that churns is a baseline that gets
  regenerated blindly.
- Keys are sorted, one per line, so diffs are minimal and reviewable.
- The value is the date the checker **first saw** that finding. This is a second, git-independent age
  channel: exact from the day the entry was recorded, and immune to every failure mode in §6.
- Refresh: `node scripts/dead-code/check.ts --update-baseline`. Persisting entries keep their original
  `since` date; fixed entries are pruned; new entries get today.

Drift behaviour:

| situation                                                      | behaviour                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| new finding, this commit is responsible                        | **blocks** (if the kind blocks)                                                                           |
| new finding, no staged file responsible                        | reports as a note — "not attributable to this commit, probably unstaged work"                             |
| baseline entry no longer a finding (someone deleted dead code) | reports `N fixed`, prints the refresh command, **never blocks**. Fixing dead code must never be punished. |
| baseline file missing or unparseable                           | **report-only, exit 0**, prints the refresh command. A first run must not block every commit in the repo. |
| baseline entry points at a deleted file                        | counted as fixed                                                                                          |

The hook never writes the baseline. A hook that mutates tracked files mid-commit produces a
half-staged working tree; refreshing is an explicit, reviewable act.

Two guards keep the ledger honest, both added after the first real hook run misbehaved:

- **`fixed` is scoped to what this run could actually see.** The oxlint channel only looks at the staged
  files in hook mode, so without a guard every `unused-local` entry for an untouched file read as fixed
  and the hook nagged on every commit. A baseline key is only eligible to be "fixed" if the run had the
  means to detect it.
- **`--update-baseline` refuses to run with `--staged` or `--no-lint`.** A partial scan would silently
  drop every `unused-local` entry from the ledger, and the next commit would report them all as fixed.

---

## 5. What blocks, and what only warns

A finding blocks **only if all three hold**:

1. its kind blocks (`unused-local`, `unused-export` of a value, `unused-css-var`, `unused-css-class`),
2. its key is **not** in the baseline, and
3. **this commit is responsible** — either the declaring file is in the staged set, or the symbol
   appears on a removed line of `git diff --cached -U0`.

Condition 3 is what makes "baseline plus delta" honest. Without it, an unstaged experiment in another
file could block an unrelated commit.

Escape hatches, in order of preference: fix it; `--update-baseline` to accept it as recorded debt;
`VIDE_SKIP_DEAD_CODE=1 git commit`; `--no-verify`.

---

## 6. Attribution, and where it lies to you

Two channels, in order of reliability.

### A. This commit (exact, free)

If condition 3 above fired via the removed-lines test, the orphaning commit **is the commit being
made**. No archaeology, no ambiguity, zero cost. This is the common case for the case that matters
most — a commit that deletes the last caller.

### B. Archaeology (automatic for up to 3 blocking findings; on demand via `--explain <symbol>`)

- **born**: oldest commit from `git log --no-renames --reverse -S<symbol> -- <source pathspec>`
- **orphaned**: newest commit from `git log --no-renames -S<symbol> -- <pathspec>`, confirmed by scanning
  that commit's own `-U0` diff for a removed line matching `\b<symbol>\b`. Run in **two passes**:
  1. pathspec **excluding** the declaring file — a confirmed hit means a cross-file caller went away,
     the strongest signal;
  2. if pass 1 confirms nothing, pathspec **restricted to** the declaring file. Everything oxlint
     reports is file-local, so its last use is inside its own file and pass 1 is structurally blind to
     it. Without pass 2 the `ChatView.tsx` case below reported no orphaning commit at all.
- **dead from birth**: if nothing confirms a removal and the only candidate is the birth commit itself,
  the symbol was never referenced. Reported as such rather than as a bogus orphaning commit.
- `.repos/` is excluded from every pickaxe. Those are vendored upstream subtrees, so a token that also
  occurs in vendored source gets its birth attributed to the subtree-sync commit that vendored it —
  observed on one of the dead easing tokens before the exclusion was added.

Cost: **1.11 s** per symbol with `--no-renames` and a pathspec; 2.55 s without (and without
`--no-renames` git also emits `exhaustive rename detection was skipped` warnings on this repo's
history). A full `--explain` is ~4.6 s because it runs the birth pickaxe over all 2181 commits plus up
to two orphan passes. Hence the cap: attribution runs automatically only when the check is already going
to fail the commit, where a few seconds buys the user the one fact they need.

Worked example, machine output, verified by hand:

```
$ node scripts/dead-code/check.ts --explain saveProjectScript
unused-local  apps/web/src/components/ChatView.tsx  saveProjectScript
  declared at line 2984, never read
  recorded as dead on 2026-07-30 (0d ago) — this date is exact
  born     3537d4770  2026-02-15  Add project script actions with run shortcuts and persistence  (165d ago)
  orphaned 74629e99d  2026-07-30  Unroll popups from their anchor, lift them off the chrome, trim the header  (dead 0d)
  best guess, confidence high
  its last use was inside its own file, and that commit removed it
```

`74629e99d` deleted `ProjectScriptsControl.tsx` (636 lines) and removed
`onAddProjectScript={saveProjectScript}` from `ChatView.tsx`. That is the correct answer.

### Where `-S` gives the right answer

- **Reformats do not pollute it.** `-S` counts occurrences of the literal string in each blob. Rewrapping
  lines does not change an occurrence count, so the repo-wide `vp fmt` pass is invisible to `-S`. This is
  precisely why attribution uses `-S` and **not** `git blame`: blame attributes every reformatted line to
  the reformat commit, which would make it useless on this history.
- Deleting a call site changes the count. That is the signal, and it is a real one.

### Where it will mislead you — stated plainly

1. **Bulk mechanical commits.** `72e692c4b` ("Rebrand T3 Code to Vide and strip non-macOS surface") is
   **14 992 files changed, 5607 insertions**, and it renamed identifiers wholesale. For any symbol whose
   _current_ name was minted there, `-S --reverse` reports `72e692c4b` as the birth — correct for the
   name, wrong for the concept. `108e01746` ("Upgrade Effect and Alchemy betas") is another, at 11 742
   files. Demonstrated: the newest `-S` hit for `SplashScreen` is `72e692c4b`.
   **Mitigation:** any candidate commit touching more than 150 files is labelled `bulk`, its confidence
   is downgraded to `low`, and the walk continues to the next candidate so both are shown. The threshold
   is calibrated on this history — the next largest commit in the last 120 is two orders of magnitude
   smaller.

   Machine output for exactly that case — the guard skipping the rebrand and landing on the real commit:

   ```
   $ node scripts/dead-code/check.ts --explain SplashScreen
   unused-export  apps/web/src/components/SplashScreen.tsx  SplashScreen
     born     b7559c467  2026-04-09  Implement server auth bootstrap and pairing flow (#1768)  (112d ago)
     orphaned 719c905ea  2026-07-23  [codex] Move mobile project grouping to General settings (#4315)  (dead 7d)
     best guess, confidence high
     skipped bulk commit 72e692c4b (14992 files) — "Rebrand T3 Code to Vide and strip non-macOS surface"
   ```

   And the case where it cannot recover, saying so instead of guessing — a token whose only remaining
   `-S` candidate _is_ the rebrand: `confidence low`, with
   `attributed to a bulk commit (14992 files) — most likely a mechanical rename, not the real orphaning`.

2. **`-S` is substring-based.** `useTheme` matches inside `useThemeSync`, so a commit that only touched
   the longer name can be nominated. **Mitigation:** candidates come from substring `-S` (a superset),
   then each is confirmed by a `\b`-anchored scan of its own `-U0` diff. Candidates that fail
   confirmation are skipped. Bulk commits are not confirmed (too expensive) — they are flagged instead.
3. **Resurrection.** A symbol deleted and reintroduced later reports its first-ever appearance as its
   birth, so "existed for N days" over-counts.
4. **Moves.** `--no-renames` is used for speed; a file move that carries the symbol along reads as a
   delete plus an add, which changes counts and can nominate the move commit.
5. **Shallow or grafted clones.** `-S` sees only the available history; on a CI shallow clone birth
   dates are simply wrong. The check reports `attribution: unavailable (shallow clone)` rather than
   guessing.

Because of 1–5, archaeology output is always printed as _"best guess"_ with an explicit confidence, and
the **baseline `since` date is printed alongside it as the reliable number.** For anything recorded since
the day the baseline was created, the age is a fact rather than an inference.

---

## 7. What this deliberately does not detect

1. **Unused files / orphan modules.** Needs an entry-point graph across eleven workspaces plus Vite,
   Electron, and MSW conventions. This is knip's strongest feature and the main reason to adopt it
   later, in CI.
2. **Unused dependencies.** Same answer.
3. **`export default`.** A default export is imported under an arbitrary local name, so a name index
   cannot see it. (`oxlint-plugin-vide/rules/*` are all default exports, legitimately consumed by
   `index.ts`.)
4. **Chained deadness.** `export { X } from "./x"` in a barrel keeps `X` alive even when the re-export
   itself is dead. One level only.
5. **Name collisions.** Effect code declares `make`, `layer`, `run` in dozens of modules. A reference to
   any one of them keeps all of them alive. Under-reports; never over-reports.
6. **References inside strings and comments** count as live. Deliberate: registries and dynamic lookups
   are real in this codebase, and a false positive in a blocking hook is worse than a miss.
7. **Unreachable statements and dead branches inside a live function.** oxlint's `no-unreachable`
   handles the trivial cases; anything more needs types.
8. **Tailwind-generated utilities from `@theme`.** `--font-sans` inside an `@theme` block becomes the
   `font-sans` utility through Tailwind codegen we do not model, so `@theme` blocks are skipped
   wholesale rather than reported as false positives.
9. **Non-namespaced CSS classes.** `index.css` styles library-rendered DOM; those class names never
   appear in our source. Only `--*` custom properties in owned files and `.vide-*` classes are checked.
10. **A symbol kept alive only by a barrel that is itself only used by tests.** Test-only detection is
    one level deep.
11. **Exports that are not at column 0.** The declaration pattern is anchored to line start, so
    `export const inner` inside an `export namespace Outer { … }` block is not treated as a top-level
    symbol. That is deliberate: it is reachable only as `Outer.inner`, and a bare-name index could not
    see its call sites, so scanning it would manufacture false positives.
12. **Partially staged files.** The scan reads the working tree, not the index, so a hunk you left
    unstaged still counts as a reference. The blocking rule is about staged _files_, not staged content,
    so the worst case is an under-report; reading index blobs through `git cat-file --batch` would fix
    it and was judged not worth the complexity for the one case where it differs.

---

## 8. The other bug fixed here

`.vite-hooks/pre-commit` ran `vp staged`, whose task is `"*": "vp fmt"` (root `vite.config.ts`). When
**every** staged file is one oxfmt has no formatter for, `vp fmt` exits non-zero with
`Expected at least one target file. All matched files may have been excluded by ignore rules.` and the
commit is refused. Reproduced with a single extensionless file, and independently with
`assets/brand/build-icons.py`. A mixed set is fine — `vp fmt build-icons.py vite.config.ts` formats the
one it can and exits 0 — so the failure is specific to an _entirely_ unformattable staged set.

Narrowing the glob was rejected: `"*.*"` still breaks on `.py`/`.png`, and an extension allowlist
silently skips dotfiles (`*.json` does not match `.oxlintrc.json` under picomatch's default dotfile
handling) and rots whenever oxfmt gains a language.

The fix is `scripts/staged-format.ts`, a wrapper that runs the same `vp fmt` with the same arguments and
treats _only_ the "expected at least one target file" exit as success. It knows nothing about which
extensions oxfmt supports, so it cannot drift out of sync with oxfmt. Every other failure — a real
syntax error, a missing binary — propagates unchanged.

---

## 9. Layout

```
scripts/dead-code/analyze.ts       reference index, declaration extraction, CSS, findings (pure)
scripts/dead-code/baseline.ts      load / classify / merge / serialise
scripts/dead-code/attribution.ts   git archaeology, two-pass orphan search, bulk-commit guard
scripts/dead-code/lint.ts          oxlint JSON ingest for the file-local channel
scripts/dead-code/check.ts         CLI, git plumbing, reporting, exit code
scripts/dead-code/baseline.json    the debt ledger (1815 entries)
scripts/lib/run-process.ts         shared spawn-and-collect helper
scripts/staged-format.ts           the vp fmt wrapper (§8)
```

Plus colocated tests: `analyze.test.ts`, `baseline.test.ts`, `attribution.test.ts` (which also covers
`lint.ts`), and `staged-format.test.ts` — 26 tests, run by `vp run --filter @vide/scripts test`.

`scripts/` rather than a new top-level directory: it is already a workspace package (`@vide/scripts`)
with `tsconfig.json`, a `typecheck` script, and colocated `*.test.ts` run by `vp test run`, and it is
already in the root `build` filter list. A new top-level directory would need its own
`package.json`/`tsconfig.json` and a new filter entry to get the same wiring.

Wiring — `.vite-hooks/pre-commit` keeps `vp staged` and gains one guarded call. The guard exists because
`core.hooksPath` is absolute and shared: a commit made in a linked worktree executes the **main**
checkout's hook file with the **worktree** as cwd, so the script may legitimately not exist yet.
