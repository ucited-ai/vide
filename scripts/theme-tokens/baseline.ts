/*
 * The decentralised-theme-value ledger.
 *
 * Same bargain as the dead-code baseline: record what is already there, block
 * only what a commit adds. A check that fails on the existing debt gets
 * `--no-verify`'d on its first day and then protects nothing.
 *
 * Unlike that baseline, an entry carries a count as well as a date. The key has
 * no line number in it — line numbers churn on every edit above them — so
 * without a count, adding a second `text-xs` to a file that already had one
 * would be invisible. The count is the only thing standing between "no new
 * files regress" and "no new occurrences at all".
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { type Finding, findingKey } from "./scan.ts";

export const BASELINE_VERSION = 1;

const BaselineEntry = Schema.Struct({
  since: Schema.String,
  count: Schema.Number,
});

const BaselineSchema = Schema.Struct({
  version: Schema.Number,
  generatedAt: Schema.String,
  findings: Schema.Record(Schema.String, BaselineEntry),
});

export type Baseline = typeof BaselineSchema.Type;

const decodeBaseline = Schema.decodeUnknownEffect(Schema.fromJsonString(BaselineSchema));

export const emptyBaseline: Baseline = {
  version: BASELINE_VERSION,
  generatedAt: "1970-01-01",
  findings: {},
};

export interface BaselineClassification {
  /** Present in the ledger at no more than the recorded count. Nothing to do. */
  readonly known: ReadonlyArray<{ readonly finding: Finding; readonly since: string }>;
  /** Absent from the ledger, or present but now more numerous. */
  readonly added: ReadonlyArray<{ readonly finding: Finding; readonly wasCount: number }>;
  /** Ledger keys that no longer appear — somebody centralised something. */
  readonly fixed: ReadonlyArray<string>;
}

/**
 * `wasScanned` guards the `fixed` list. In hook mode only the staged files are
 * read, so every entry for an untouched file would otherwise read as fixed and
 * the hook would nag about refreshing the baseline on every single commit.
 */
export const classifyAgainstBaseline = (
  findings: ReadonlyArray<Finding>,
  baseline: Baseline,
  wasScanned: (key: string) => boolean = () => true,
): BaselineClassification => {
  const known: Array<{ finding: Finding; since: string }> = [];
  const added: Array<{ finding: Finding; wasCount: number }> = [];
  const live = new Set<string>();

  for (const finding of findings) {
    const key = findingKey(finding);
    live.add(key);
    const entry = baseline.findings[key];
    if (entry === undefined) {
      added.push({ finding, wasCount: 0 });
      continue;
    }
    if (finding.count > entry.count) {
      added.push({ finding, wasCount: entry.count });
      continue;
    }
    known.push({ finding, since: entry.since });
  }

  const fixed = Object.keys(baseline.findings)
    .filter((key) => !live.has(key) && wasScanned(key))
    .toSorted((left, right) => left.localeCompare(right));

  return { known, added, fixed };
};

/**
 * Persisting entries keep their original `since` and take the current count, so
 * removing occurrences ratchets the ledger down without a manual edit.
 */
export const mergeBaseline = (
  findings: ReadonlyArray<Finding>,
  previous: Baseline,
  today: string,
): Baseline => {
  const merged: Record<string, { since: string; count: number }> = {};
  const keyed = findings
    .map((finding) => [findingKey(finding), finding] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  for (const [key, finding] of keyed) {
    merged[key] = { since: previous.findings[key]?.since ?? today, count: finding.count };
  }
  return { version: BASELINE_VERSION, generatedAt: today, findings: merged };
};

/** Two-space JSON with a trailing newline, i.e. exactly what oxfmt would produce. */
export const serializeBaseline = (baseline: Baseline): string =>
  `${JSON.stringify(baseline, undefined, 2)}\n`;

/**
 * A missing or corrupt ledger must never block: without it every pre-existing
 * finding reads as new and no commit could land.
 */
export const loadBaseline = Effect.fn("loadBaseline")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return { _tag: "missing" } as const;

  const raw = yield* fs.readFileString(path).pipe(Effect.option);
  if (raw._tag === "None") {
    return { _tag: "unreadable", reason: `could not read ${path}` } as const;
  }

  const decoded = yield* decodeBaseline(raw.value).pipe(Effect.option);
  if (decoded._tag === "None") {
    return { _tag: "unreadable", reason: `could not parse ${path}` } as const;
  }
  if (decoded.value.version !== BASELINE_VERSION) {
    return {
      _tag: "unreadable",
      reason: `${path} is version ${decoded.value.version}, this checker speaks ${BASELINE_VERSION}`,
    } as const;
  }
  return { _tag: "loaded", baseline: decoded.value } as const;
});

export const writeBaseline = Effect.fn("writeBaseline")(function* (
  path: string,
  baseline: Baseline,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(path, serializeBaseline(baseline));
});
