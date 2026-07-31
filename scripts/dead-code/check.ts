#!/usr/bin/env node

/*
 * Pre-commit dead-code gate. See DEAD-CODE-CHECK-DESIGN.md for the reasoning,
 * including why this is not knip.
 *
 *   node scripts/dead-code/check.ts                     full report, always exit 0
 *   node scripts/dead-code/check.ts --staged            hook mode: block on new, own findings
 *   node scripts/dead-code/check.ts --update-baseline   accept the current set as debt
 *   node scripts/dead-code/check.ts --attribute         add git archaeology to the report
 *
 * `VIDE_SKIP_DEAD_CODE=1` disables the gate for one commit.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";

import { runProcess } from "../lib/run-process.ts";
import {
  type Finding,
  type SourceFile,
  analyzeSources,
  compareFindings,
  defaultAnalyzeConfig,
} from "./analyze.ts";
import {
  type Baseline,
  classifyAgainstBaseline,
  emptyBaseline,
  loadBaseline,
  mergeBaseline,
  writeBaseline,
} from "./baseline.ts";
import { type Attribution, attributeSymbol } from "./attribution.ts";
import { collectUnusedLocals } from "./lint.ts";

const BASELINE_FILE = "scripts/dead-code/baseline.json";

/** Attribution costs ~1.1s per symbol; only spend it when the commit is failing. */
const MAX_ATTRIBUTED_FINDINGS = 3;

/*
 * `*.html` and `*.json` are in because they carry real wiring (script tags, bin and
 * script entries). `*.md` is deliberately out: a name mentioned in prose is not a
 * reference, and a design document that names a dead symbol must not resurrect it.
 */
const SOURCE_GLOBS = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.css",
  "*.html",
  "*.json",
] as const;

/**
 * Paths that must never contribute references. The baseline lists every finding by
 * name, so scanning it would keep the entire ledger alive and empty itself out.
 */
const NON_REFERENCE_PATHS = new Set(["pnpm-lock.yaml", "scripts/dead-code/baseline.json"]);

const LINTABLE = /\.[cm]?[jt]sx?$/;

const REFERENCE_TOKEN = /--[A-Za-z0-9_-]+|[A-Za-z_$][A-Za-z0-9_$]*/g;

const tokensOf = (text: string): ReadonlySet<string> => {
  const tokens = new Set<string>();
  REFERENCE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_TOKEN.exec(text)) !== null) tokens.add(match[0]);
  return tokens;
};

const git = Effect.fn("git")(function* (args: ReadonlyArray<string>, cwd: string) {
  const result = yield* runProcess("git", args, { cwd });
  return result.exitCode === 0 ? result.stdout : "";
});

const listTrackedPaths = Effect.fn("listTrackedPaths")(function* (root: string) {
  const stdout = yield* git(["ls-files", "-z", "--", ...SOURCE_GLOBS], root);
  return stdout
    .split("\0")
    .filter(
      (path) => path.length > 0 && !path.startsWith(".repos/") && !NON_REFERENCE_PATHS.has(path),
    );
});

/*
 * Unreadable files are skipped rather than fatal. This repo contains a committed
 * broken symlink (CLAUDE.md -> "AGENTS.md\n", with a trailing newline inside the
 * link target), which crashes any naive read loop.
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

interface StagedContext {
  readonly paths: ReadonlySet<string>;
  readonly removedTokens: ReadonlySet<string>;
  readonly addedTokens: ReadonlySet<string>;
}

const emptyStagedContext: StagedContext = {
  paths: new Set(),
  removedTokens: new Set(),
  addedTokens: new Set(),
};

const readStagedContext = Effect.fn("readStagedContext")(function* (root: string) {
  const names = yield* git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root);
  const paths = new Set(names.split("\0").filter((path) => path.length > 0));

  const diff = yield* git(["diff", "--cached", "-U0", "--no-color", "--no-renames"], root);
  const removed: Array<string> = [];
  const added: Array<string> = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
    else if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
  }
  const addedTokens = tokensOf(added.join("\n"));
  const removedTokens = new Set(
    [...tokensOf(removed.join("\n"))].filter((t) => !addedTokens.has(t)),
  );

  return { paths, removedTokens, addedTokens } satisfies StagedContext;
});

/**
 * A new finding blocks only when this commit is responsible for it: the declaring
 * file is staged, or the commit deleted a line that referenced the symbol. Without
 * this, unstaged work in another file could block an unrelated commit.
 */
const isThisCommitResponsible = (finding: Finding, staged: StagedContext): boolean =>
  staged.paths.has(finding.path) || staged.removedTokens.has(finding.symbol);

const localAttribution = (finding: Finding, staged: StagedContext): string | undefined => {
  if (staged.removedTokens.has(finding.symbol)) {
    return "orphaned by the commit you are making — it deleted the last reference";
  }
  if (staged.paths.has(finding.path) && staged.addedTokens.has(finding.symbol)) {
    return "introduced dead by the commit you are making";
  }
  return undefined;
};

const daysBetween = (from: string, to: string): number | undefined => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 86_400_000));
};

const formatAttribution = (attribution: Attribution, today: string): ReadonlyArray<string> => {
  const lines: Array<string> = [];
  if (attribution.born !== undefined) {
    const age = daysBetween(attribution.born.date, today);
    lines.push(
      `born     ${attribution.born.hash}  ${attribution.born.date}  ${attribution.born.subject}` +
        (age === undefined ? "" : `  (${age}d ago)`),
    );
  }
  if (attribution.orphanedBy !== undefined) {
    const dead = daysBetween(attribution.orphanedBy.date, today);
    lines.push(
      `orphaned ${attribution.orphanedBy.hash}  ${attribution.orphanedBy.date}  ${attribution.orphanedBy.subject}` +
        (dead === undefined ? "" : `  (dead ${dead}d)`),
    );
  }
  lines.push(`best guess, confidence ${attribution.confidence}`);
  if (attribution.note !== undefined) lines.push(attribution.note);
  return lines;
};

const summarizeByKind = (findings: ReadonlyArray<Finding>): string => {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
};

const printFinding = Effect.fn("printFinding")(function* (
  label: string,
  finding: Finding,
  extra: ReadonlyArray<string>,
) {
  yield* Console.log(`  ${label}  ${finding.kind}  ${finding.path}  ${finding.symbol}`);
  yield* Console.log(`         ${finding.detail}`);
  for (const line of extra) yield* Console.log(`         ${line}`);
});

interface RunOptions {
  readonly staged: boolean;
  readonly updateBaseline: boolean;
  readonly attribute: boolean;
  readonly lint: boolean;
  readonly limit: number;
  readonly explain: string | undefined;
}

const run = Effect.fn("run")(function* (options: RunOptions) {
  const started = yield* Effect.sync(() => performance.now());
  const path = yield* Path.Path;
  const cwd = process.cwd();
  const rootStdout = yield* git(["rev-parse", "--show-toplevel"], cwd);
  const root = rootStdout.trim().length > 0 ? rootStdout.trim() : cwd;

  const trackedPaths = yield* listTrackedPaths(root);
  const files = yield* readSources(root, trackedPaths);
  const staged = options.staged ? yield* readStagedContext(root) : emptyStagedContext;

  // Hook mode lints only the staged files (0.6s); baseline refresh and the full
  // report lint the whole repo (2.6s) so the ledger stays complete.
  const lintPaths = options.staged
    ? [...staged.paths].filter((candidate) => LINTABLE.test(candidate))
    : [];
  const lintResult =
    options.lint && (!options.staged || lintPaths.length > 0)
      ? yield* collectUnusedLocals(lintPaths, root)
      : { findings: [] as ReadonlyArray<Finding>, problem: undefined };

  /*
   * oxlint walks the filesystem, so a full-repo run also descends into nested
   * checkouts — `.claude/worktrees/<agent>/` most often, which mirrors the whole
   * tree and therefore reports every one of its unused locals a second time.
   * `analyzeSources` never had this problem because it reads `git ls-files`.
   * Intersecting with the tracked set is the same rule stated once: if git does
   * not track the file, it is not this repo's code.
   */
  const tracked = new Set(files.map((file) => file.path));
  const findings = [
    ...analyzeSources(files, defaultAnalyzeConfig),
    ...lintResult.findings.filter((finding) => tracked.has(finding.path)),
  ].toSorted(compareFindings);

  const baselinePath = path.join(root, BASELINE_FILE);
  const loaded = yield* loadBaseline(baselinePath);
  const baseline: Baseline = loaded._tag === "loaded" ? loaded.baseline : emptyBaseline;
  const trusted = loaded._tag === "loaded";
  // Only the paths oxlint actually saw can be declared clean of unused locals.
  const linted = new Set(lintPaths);
  const wasDetectable = (key: string): boolean => {
    const [kind, filePath] = key.split(":");
    if (kind !== "unused-local") return true;
    if (!options.lint) return false;
    return lintPaths.length === 0 || (filePath !== undefined && linted.has(filePath));
  };
  const classified = classifyAgainstBaseline(findings, baseline, wasDetectable);
  const today = DateTime.formatIso(yield* DateTime.now).slice(0, 10);

  if (options.explain !== undefined) {
    const symbol = options.explain;
    const matches = [
      ...classified.known,
      ...classified.added.map((finding) => ({ finding, since: undefined })),
    ].filter((entry) => entry.finding.symbol === symbol);
    if (matches.length === 0) {
      yield* Console.log(`dead code: ${symbol} is not a current finding; nothing to explain`);
      return;
    }
    for (const { finding, since } of matches) {
      yield* Console.log(`${finding.kind}  ${finding.path}  ${finding.symbol}`);
      yield* Console.log(`  ${finding.detail}`);
      // The baseline date is a fact; the archaeology below is an inference.
      if (since !== undefined) {
        const recorded = daysBetween(since, today);
        yield* Console.log(
          `  recorded as dead on ${since}${recorded === undefined ? "" : ` (${recorded}d ago)`} — this date is exact`,
        );
      }
      const attribution = yield* attributeSymbol(symbol, finding.path, root);
      for (const line of formatAttribution(attribution, today)) yield* Console.log(`  ${line}`);
    }
    return;
  }

  if (options.updateBaseline) {
    // Without the oxlint channel the ledger would silently lose every
    // `unused-local` entry, and the next commit would report them all as fixed.
    if (!options.lint || options.staged) {
      yield* Console.log(
        "dead code: --update-baseline needs a full scan; drop --staged and --no-lint",
      );
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
      return;
    }
    /*
     * Asking for the channel is not the same as getting it. If oxlint failed to
     * spawn or returned something that would not parse, its findings are empty
     * and only `problem` says so — writing that would drop every `unused-local`
     * entry from the ledger and the next healthy run would report them as newly
     * fixed, which is the precise failure the guard above exists to prevent.
     */
    if (lintResult.problem !== undefined) {
      yield* Console.log(
        `dead code: --update-baseline refused, the lint channel failed: ${lintResult.problem}`,
      );
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
      return;
    }
    yield* writeBaseline(baselinePath, mergeBaseline(findings, baseline, today));
    yield* Console.log(
      `dead code: baseline written with ${findings.length} entries (${classified.added.length} added, ${classified.fixed.length} pruned)`,
    );
    yield* Console.log(BASELINE_FILE);
    return;
  }

  const owned = options.staged
    ? classified.added.filter((finding) => isThisCommitResponsible(finding, staged))
    : classified.added;
  const blocking = trusted ? owned.filter((finding) => finding.severity === "block") : [];
  const disowned = options.staged
    ? classified.added.filter((finding) => !isThisCommitResponsible(finding, staged))
    : [];

  const elapsed = yield* Effect.sync(() => Math.round(performance.now() - started));
  yield* Console.log(
    `dead code: ${classified.added.length} new, ${classified.known.length} known, ${classified.fixed.length} fixed  (${files.length} files, ${elapsed}ms)`,
  );
  if (findings.length > 0) yield* Console.log(`  ${summarizeByKind(findings)}`);
  if (lintResult.problem !== undefined) {
    yield* Console.log(`  note: ${lintResult.problem}; the file-local channel was skipped`);
  }
  if (!trusted) {
    yield* Console.log(
      loaded._tag === "missing"
        ? `  note: no baseline at ${BASELINE_FILE}; reporting only. Create it with --update-baseline`
        : `  note: ${loaded.reason}; reporting only. Recreate it with --update-baseline`,
    );
  }

  const attributionBudget = blocking.length > 0 || options.attribute;
  const toAttribute = new Set(
    (attributionBudget ? (blocking.length > 0 ? blocking : owned) : []).slice(
      0,
      MAX_ATTRIBUTED_FINDINGS,
    ),
  );

  // Outside hook mode `owned` is every finding in the repo, so only the blocking
  // kinds are listed and only up to `--limit`; the per-kind summary above carries
  // the rest. In hook mode `owned` is small by construction and all of it prints.
  const candidates = options.staged
    ? owned
    : owned.filter((finding) => finding.severity === "block");
  const listed = candidates.slice(0, options.limit);

  for (const finding of listed) {
    const local = localAttribution(finding, staged);
    const extra: Array<string> = [];
    if (local !== undefined) extra.push(local);
    else if (toAttribute.has(finding)) {
      const attribution = yield* attributeSymbol(finding.symbol, finding.path, root);
      extra.push(...formatAttribution(attribution, today));
    }
    yield* printFinding(
      finding.severity === "block" && trusted ? "BLOCK" : "note ",
      finding,
      extra,
    );
  }

  const unlisted = candidates.length - listed.length;
  if (unlisted > 0) {
    yield* Console.log(`  ... and ${unlisted} more; raise --limit or see ${BASELINE_FILE}`);
  }

  for (const finding of disowned.slice(0, 10)) {
    yield* printFinding("note ", finding, [
      "not attributable to this commit — most likely unstaged work",
    ]);
  }

  if (classified.fixed.length > 0) {
    yield* Console.log(
      `  ${classified.fixed.length} baseline ${classified.fixed.length === 1 ? "entry is" : "entries are"} no longer dead. Refresh with: node ${BASELINE_FILE.replace("baseline.json", "check.ts")} --update-baseline`,
    );
  }

  if (blocking.length === 0) return;

  yield* Console.log("");
  yield* Console.log(
    `Commit blocked by ${blocking.length} new dead ${blocking.length === 1 ? "symbol" : "symbols"}. Delete them, accept them with --update-baseline, or bypass once with VIDE_SKIP_DEAD_CODE=1.`,
  );
  yield* Effect.sync(() => {
    process.exitCode = 1;
  });
});

const command = Command.make(
  "dead-code-check",
  {
    staged: Flag.boolean("staged").pipe(
      Flag.withDescription("Hook mode: block only on new findings this commit is responsible for."),
      Flag.withDefault(false),
    ),
    updateBaseline: Flag.boolean("update-baseline").pipe(
      Flag.withDescription("Rewrite the baseline from the current findings."),
      Flag.withDefault(false),
    ),
    attribute: Flag.boolean("attribute").pipe(
      Flag.withDescription("Run git archaeology even when nothing blocks."),
      Flag.withDefault(false),
    ),
    lint: Flag.boolean("lint").pipe(
      Flag.withDescription("Include oxlint's file-local unused-variable channel."),
      Flag.withDefault(true),
    ),
    limit: Flag.integer("limit").pipe(
      Flag.withDescription("Maximum findings to list individually."),
      Flag.withDefault(40),
    ),
    explain: Flag.string("explain").pipe(
      Flag.withDescription("Attribute one symbol: when it was born, what orphaned it, how long."),
      Flag.optional,
    ),
  },
  (options) =>
    process.env["VIDE_SKIP_DEAD_CODE"] === "1" && options.staged
      ? Console.log("dead code: skipped (VIDE_SKIP_DEAD_CODE=1)")
      : run({ ...options, explain: Option.getOrUndefined(options.explain) }),
).pipe(
  Command.withDescription(
    "Report dead code, block on dead code this commit created, and attribute it.",
  ),
);

if (import.meta.main) {
  Command.run(command, { version: "1.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
