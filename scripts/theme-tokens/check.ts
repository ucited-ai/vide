#!/usr/bin/env node

/*
 * Pre-commit guard against theme values drifting back out of the theme.
 *
 *   node scripts/theme-tokens/check.ts                    full report, always exit 0
 *   node scripts/theme-tokens/check.ts --staged           hook mode: block on what this commit adds
 *   node scripts/theme-tokens/check.ts --update-baseline  accept the current set as debt
 *
 * `VIDE_SKIP_THEME_TOKENS=1` disables the gate for one commit.
 *
 * Sibling of the dead-code gate and deliberately its mirror image: that one asks
 * "is this token declared and never used", this one asks "is this value used and
 * never declared". Between them a colour or a size has nowhere to hide.
 *
 * Files come from `git ls-files`, which is what keeps a linked worktree under
 * `.claude/worktrees/` from being counted twice — worktrees are untracked, so a
 * tracked-file listing never walks into them, while a filesystem glob does and
 * silently doubles every number.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";

import { runProcess } from "../lib/run-process.ts";
import {
  type Finding,
  type SourceFile,
  advice,
  defaultScanConfig,
  findingKey,
  scanSources,
} from "./scan.ts";
import {
  classifyAgainstBaseline,
  emptyBaseline,
  loadBaseline,
  mergeBaseline,
  writeBaseline,
} from "./baseline.ts";

const BASELINE_FILE = "scripts/theme-tokens/baseline.json";

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.css"] as const;

const git = Effect.fn("git")(function* (args: ReadonlyArray<string>, cwd: string) {
  const result = yield* runProcess("git", args, { cwd });
  return result.exitCode === 0 ? result.stdout : "";
});

const listTrackedPaths = Effect.fn("listTrackedPaths")(function* (root: string) {
  const stdout = yield* git(["ls-files", "-z", "--", ...SOURCE_GLOBS], root);
  return stdout.split("\0").filter((path) => path.length > 0 && !path.startsWith(".repos/"));
});

const listStagedPaths = Effect.fn("listStagedPaths")(function* (root: string) {
  const stdout = yield* git(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z", "--", ...SOURCE_GLOBS],
    root,
  );
  return stdout.split("\0").filter((path) => path.length > 0);
});

/*
 * Unreadable files are skipped rather than fatal. This repo carries a committed
 * broken symlink (`CLAUDE.md` -> `"AGENTS.md\n"`, newline inside the target),
 * which crashes any naive read loop.
 */
const readSources = Effect.fn("readSources")(function* (
  root: string,
  paths: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const results = yield* Effect.forEach(
    paths,
    (relative) =>
      fs.readFileString(path.join(root, relative)).pipe(
        Effect.map((content): SourceFile | undefined => ({ path: relative, content })),
        Effect.orElseSucceed(() => undefined),
      ),
    { concurrency: 64 },
  );
  return results.filter((entry): entry is SourceFile => entry !== undefined);
});

const summarize = (findings: ReadonlyArray<Finding>): string => {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + finding.count);
  }
  return [...counts.entries()]
    .toSorted(([, left], [, right]) => right - left)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
};

const occurrences = (finding: Finding): string =>
  finding.count === 1 ? "" : ` ×${String(finding.count)}`;

const printFinding = Effect.fn("printFinding")(function* (
  label: string,
  finding: Finding,
  note: string,
) {
  yield* Console.log(
    `  ${label}  ${finding.kind}  ${finding.path}:${String(finding.line)}  ${finding.value}${occurrences(finding)}`,
  );
  yield* Console.log(`         ${note}`);
});

const run = Effect.fn("themeTokensCheck")(function* (options: {
  readonly staged: boolean;
  readonly updateBaseline: boolean;
  readonly limit: number;
}) {
  const path = yield* Path.Path;
  const root = (yield* git(["rev-parse", "--show-toplevel"], process.cwd())).trim();
  if (root === "") {
    yield* Console.log("theme tokens: not a git repository, skipping");
    return;
  }

  const started = yield* Effect.sync(() => performance.now());
  const scanned = options.staged ? yield* listStagedPaths(root) : yield* listTrackedPaths(root);
  const sources = yield* readSources(root, scanned);
  const findings = scanSources(sources, defaultScanConfig);

  const baselinePath = path.join(root, BASELINE_FILE);
  const loaded = yield* loadBaseline(baselinePath);
  const baseline = loaded._tag === "loaded" ? loaded.baseline : emptyBaseline;
  const today = DateTime.formatIsoDate(yield* DateTime.now);

  if (options.updateBaseline) {
    /* Always rewrite from a whole-repo scan: a staged subset would delete every
       entry the commit did not happen to touch. */
    const whole = options.staged
      ? scanSources(yield* readSources(root, yield* listTrackedPaths(root)), defaultScanConfig)
      : findings;
    yield* writeBaseline(baselinePath, mergeBaseline(whole, baseline, today));
    yield* Console.log(
      `theme tokens: baseline updated — ${String(whole.length)} entries (${summarize(whole)})`,
    );
    return;
  }

  /*
   * Nothing blocks without a ledger to compare against. A missing or corrupt
   * baseline would otherwise read the entire existing debt as new and refuse
   * every commit in the repo.
   */
  const trusted = loaded._tag === "loaded";
  if (loaded._tag === "unreadable") {
    yield* Console.log(`theme tokens: ${loaded.reason} — reporting only, nothing will block`);
  }
  if (loaded._tag === "missing") {
    yield* Console.log(
      `theme tokens: no ${BASELINE_FILE} yet — reporting only. Create it with --update-baseline.`,
    );
  }

  const scannedPaths = new Set(scanned);
  const classified = classifyAgainstBaseline(findings, baseline, (key) => {
    /* key is `kind:path:value`, and a path can contain colons on no filesystem
       this repo supports — but the value can, so split from the left only. */
    const [, keyPath] = key.split(":", 2);
    return keyPath !== undefined && scannedPaths.has(keyPath);
  });

  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  const elapsed = yield* Effect.sync(() => Math.round(performance.now() - started));
  yield* Console.log(
    `theme tokens: ${String(classified.added.length)} new, ${String(classified.known.length)} known, ${String(classified.fixed.length)} centralised  (${String(sources.length)} files, ${String(elapsed)}ms)`,
  );
  if (total > 0) yield* Console.log(`  ${summarize(findings)}`);

  const blocking = options.staged && trusted ? classified.added : [];

  for (const { finding, wasCount } of classified.added.slice(0, options.limit)) {
    yield* printFinding(
      blocking.length > 0 ? "BLOCK" : "note ",
      finding,
      wasCount === 0
        ? advice[finding.kind]
        : `${String(wasCount)} was on record, ${String(finding.count)} now — ${advice[finding.kind]}`,
    );
  }

  const unlisted = classified.added.length - Math.min(classified.added.length, options.limit);
  if (unlisted > 0) {
    yield* Console.log(`  ... and ${String(unlisted)} more; raise --limit or see ${BASELINE_FILE}`);
  }

  if (classified.fixed.length > 0) {
    yield* Console.log(
      `  ${String(classified.fixed.length)} baseline ${classified.fixed.length === 1 ? "entry is" : "entries are"} centralised now. Refresh with: node scripts/theme-tokens/check.ts --update-baseline`,
    );
  }

  if (blocking.length === 0) return;

  yield* Console.log("");
  yield* Console.log(
    `Commit blocked by ${String(blocking.length)} theme ${blocking.length === 1 ? "value" : "values"} outside the theme. Move them onto a token, accept them with --update-baseline, or bypass once with VIDE_SKIP_THEME_TOKENS=1.`,
  );
  yield* Effect.sync(() => {
    process.exitCode = 1;
  });
});

const command = Command.make(
  "theme-tokens-check",
  {
    staged: Flag.boolean("staged").pipe(
      Flag.withDescription("Hook mode: scan the staged files and block on what this commit adds."),
      Flag.withDefault(false),
    ),
    updateBaseline: Flag.boolean("update-baseline").pipe(
      Flag.withDescription("Rewrite the baseline from the current findings."),
      Flag.withDefault(false),
    ),
    limit: Flag.integer("limit").pipe(
      Flag.withDescription("Maximum findings to list individually."),
      Flag.withDefault(40),
    ),
  },
  (options) =>
    process.env["VIDE_SKIP_THEME_TOKENS"] === "1" && options.staged
      ? Console.log("theme tokens: skipped (VIDE_SKIP_THEME_TOKENS=1)")
      : run(options),
).pipe(
  Command.withDescription(
    "Report colours and text sizes hardcoded outside the theme, and block on new ones.",
  ),
);

if (import.meta.main) {
  Command.run(command, { version: "1.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}

export { findingKey };
