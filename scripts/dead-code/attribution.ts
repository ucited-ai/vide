/*
 * Git archaeology: which commit orphaned a symbol, and how long it has existed.
 *
 * `git log -S` counts occurrences of a literal string per blob, which is the only
 * reason this is usable on this history: rewrapping lines does not change an
 * occurrence count, so the repo-wide `vp fmt` pass is invisible to `-S`. `git blame`
 * would attribute every reformatted line to the reformat commit and be useless.
 *
 * What it does get wrong, and what is done about it:
 *
 * - Bulk mechanical commits. 72e692c4b ("Rebrand T3 Code to Vide") is 14992 files
 *   and renamed identifiers wholesale, so for any symbol whose *current* name was
 *   minted there, `-S --reverse` calls it the birth: right about the name, wrong
 *   about the concept. Any candidate above BULK_COMMIT_FILE_THRESHOLD is labelled
 *   `bulk`, downgraded to low confidence, and the walk continues past it.
 * - `-S` is substring-based, so `useTheme` matches inside `useThemeSync`. Candidates
 *   are therefore a superset, and each is confirmed by a word-anchored scan of its
 *   own `-U0` diff before being reported.
 * - Resurrection (deleted, later reintroduced) reports the first-ever appearance,
 *   so "existed for N days" over-counts.
 * - `--no-renames` is used for speed, so a file move that carries the symbol reads
 *   as a delete plus an add and can nominate the move commit.
 * - Shallow clones see no history worth trusting; that is reported, not guessed.
 *
 * Because of all of the above the result is always presented as a best guess with an
 * explicit confidence, next to the baseline's `since` date, which is a fact.
 */

import * as Effect from "effect/Effect";

import { runProcess } from "../lib/run-process.ts";

/**
 * Calibrated on this history: the two bulk commits touch 14992 and 11742 files,
 * while the next largest in the last 120 commits is two orders of magnitude
 * smaller. Nothing sits near the line.
 */
export const BULK_COMMIT_FILE_THRESHOLD = 150;

/** `git show` on a 15000-file commit is unbounded; we only need the header. */
const MAX_DIFF_BYTES = 512 * 1024;

/*
 * `.repos/` is excluded from every pickaxe. It holds vendored upstream subtrees, so
 * without the exclusion a token that also occurs in vendored CSS or TypeScript gets
 * its birth attributed to the subtree-sync commit that vendored it. That was
 * observed on one of the dead easing tokens in the theme file.
 *
 * Real symbol names are kept out of comments here for the same reason they are kept
 * out of the test fixtures: a comment is an occurrence, and an occurrence keeps a
 * symbol alive in the very index this checker builds.
 */
const SOURCE_PATHSPEC = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.css",
  "*.html",
  ":!.repos",
] as const;

type AttributionConfidence = "high" | "low" | "unknown";

interface CommitSummary {
  readonly hash: string;
  readonly date: string;
  readonly subject: string;
  readonly filesChanged: number;
  readonly isBulk: boolean;
}

export interface Attribution {
  readonly symbol: string;
  readonly born: CommitSummary | undefined;
  readonly orphanedBy: CommitSummary | undefined;
  readonly confidence: AttributionConfidence;
  readonly note: string | undefined;
}

const COMMIT_FORMAT = "%H%x09%ad%x09%s";

export const parseCommitLines = (
  stdout: string,
): ReadonlyArray<{ hash: string; date: string; subject: string }> =>
  stdout
    .split("\n")
    .filter((line) => line.includes("\t"))
    .flatMap((line) => {
      const [hash, date, ...subject] = line.split("\t");
      if (hash === undefined || date === undefined) return [];
      return [{ hash, date, subject: subject.join("\t") }];
    });

export const parseFilesChanged = (shortstat: string): number => {
  const match = /(\d+) files? changed/.exec(shortstat);
  return match?.[1] === undefined ? 0 : Number(match[1]);
};

/** True when the commit's own diff removes a word-anchored occurrence of the name. */
export const diffRemovesSymbol = (diff: string, symbol: string): boolean => {
  const pattern = new RegExp(
    `^-(?!--)(?:.*[^A-Za-z0-9_$])?${symbol.replaceAll("-", "\\-")}(?![A-Za-z0-9_$])`,
    "m",
  );
  return pattern.test(diff);
};

const git = (args: ReadonlyArray<string>, cwd: string) =>
  runProcess("git", args, { cwd, maxStdoutBytes: MAX_DIFF_BYTES });

const describeCommit = Effect.fn("describeCommit")(function* (
  hash: string,
  date: string,
  subject: string,
  cwd: string,
) {
  const stat = yield* git(["show", "--shortstat", "--format=", "--no-renames", hash], cwd);
  const filesChanged = parseFilesChanged(stat.stdout);
  return {
    hash: hash.slice(0, 9),
    date,
    subject,
    filesChanged,
    isBulk: filesChanged > BULK_COMMIT_FILE_THRESHOLD,
  } satisfies CommitSummary;
});

const isShallowRepository = Effect.fn("isShallowRepository")(function* (cwd: string) {
  const result = yield* git(["rev-parse", "--is-shallow-repository"], cwd);
  return result.stdout.trim() === "true";
});

/**
 * Best guess at the commit that removed the last reference, and at the commit that
 * introduced the name. Costs ~1.1s per symbol on this history, which is why callers
 * cap how many symbols they attribute.
 */
const EMPTY_PROCESS_RESULT = { exitCode: 1, stdout: "", stderr: "" } as const;
interface OrphanSearch {
  readonly confirmed: CommitSummary | undefined;
  readonly fallback: CommitSummary | undefined;
  readonly skippedBulk: CommitSummary | undefined;
}

/**
 * Newest first, walking until a candidate's own `-U0` diff confirms it removed a
 * word-anchored occurrence. Bulk commits are skipped rather than confirmed: their
 * diffs are far too large to scan, and they are untrustworthy anyway.
 */
const findOrphaningCommit = Effect.fn("findOrphaningCommit")(function* (
  symbol: string,
  pathspec: ReadonlyArray<string>,
  cwd: string,
) {
  const log = yield* git(
    [
      "log",
      "--no-renames",
      `--format=${COMMIT_FORMAT}`,
      "--date=short",
      "-S",
      symbol,
      "--",
      ...pathspec,
    ],
    cwd,
  ).pipe(Effect.orElseSucceed(() => EMPTY_PROCESS_RESULT));

  let fallback: CommitSummary | undefined;
  let skippedBulk: CommitSummary | undefined;
  for (const candidate of parseCommitLines(log.stdout).slice(0, 8)) {
    const summary = yield* describeCommit(
      candidate.hash,
      candidate.date,
      candidate.subject,
      cwd,
    ).pipe(Effect.orElseSucceed(() => undefined));
    if (summary === undefined) continue;

    if (summary.isBulk) {
      skippedBulk ??= summary;
      fallback ??= summary;
      continue;
    }

    const diff = yield* git(
      ["show", "-U0", "--format=", "--no-renames", candidate.hash, "--", ...pathspec],
      cwd,
    ).pipe(Effect.orElseSucceed(() => EMPTY_PROCESS_RESULT));

    if (diffRemovesSymbol(diff.stdout, symbol)) {
      return { confirmed: summary, fallback, skippedBulk } satisfies OrphanSearch;
    }
    fallback ??= summary;
  }
  return { confirmed: undefined, fallback, skippedBulk } satisfies OrphanSearch;
});

export const attributeSymbol = Effect.fn("attributeSymbol")(function* (
  symbol: string,
  declaringPath: string,
  cwd: string,
) {
  if (yield* isShallowRepository(cwd).pipe(Effect.orElseSucceed(() => false))) {
    return {
      symbol,
      born: undefined,
      orphanedBy: undefined,
      confidence: "unknown",
      note: "shallow clone, history unavailable",
    } satisfies Attribution;
  }

  const birthLog = yield* git(
    [
      "log",
      "--no-renames",
      "--reverse",
      `--format=${COMMIT_FORMAT}`,
      "--date=short",
      "-S",
      symbol,
      "--",
      ...SOURCE_PATHSPEC,
    ],
    cwd,
  ).pipe(Effect.orElseSucceed(() => EMPTY_PROCESS_RESULT));
  const birthCandidate = parseCommitLines(birthLog.stdout)[0];
  const born =
    birthCandidate === undefined
      ? undefined
      : yield* describeCommit(
          birthCandidate.hash,
          birthCandidate.date,
          birthCandidate.subject,
          cwd,
        ).pipe(Effect.orElseSucceed(() => undefined));

  // Pass 1 excludes the declaring file, so a confirmed hit means a *cross-file*
  // caller went away — the strongest signal. Pass 2 includes it, because a
  // file-local symbol (everything oxlint reports) loses its last use inside its own
  // file, and pass 1 is structurally blind to that.
  const crossFile = yield* findOrphaningCommit(
    symbol,
    [...SOURCE_PATHSPEC, `:!${declaringPath}`],
    cwd,
  );
  const sameFile =
    crossFile.confirmed === undefined
      ? yield* findOrphaningCommit(symbol, [declaringPath], cwd)
      : ({
          confirmed: undefined,
          fallback: undefined,
          skippedBulk: undefined,
        } satisfies OrphanSearch);

  const bulkNote = (search: OrphanSearch) =>
    search.skippedBulk === undefined
      ? undefined
      : `skipped bulk commit ${search.skippedBulk.hash} (${search.skippedBulk.filesChanged} files) — "${search.skippedBulk.subject}"`;

  if (crossFile.confirmed !== undefined) {
    return {
      symbol,
      born,
      orphanedBy: crossFile.confirmed,
      confidence: "high",
      note: bulkNote(crossFile),
    } satisfies Attribution;
  }

  if (sameFile.confirmed !== undefined) {
    return {
      symbol,
      born,
      orphanedBy: sameFile.confirmed,
      confidence: "high",
      note: "its last use was inside its own file, and that commit removed it",
    } satisfies Attribution;
  }

  const fallback = crossFile.fallback ?? sameFile.fallback;

  // Nothing confirmed a removal and the only candidate is the commit that
  // introduced the name: it was never referenced at all.
  if (fallback === undefined || (born !== undefined && fallback.hash === born.hash)) {
    return {
      symbol,
      born,
      orphanedBy: undefined,
      confidence: born === undefined ? "unknown" : "high",
      note: "dead from birth — no commit ever removed a reference to it",
    } satisfies Attribution;
  }

  return {
    symbol,
    born,
    orphanedBy: fallback,
    confidence: "low",
    note: fallback.isBulk
      ? `attributed to a bulk commit (${fallback.filesChanged} files) — most likely a mechanical rename, not the real orphaning`
      : "no commit diff confirms the removal; the last caller may have gone with a file move",
  } satisfies Attribution;
});
