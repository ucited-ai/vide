/*
 * The dead-code debt ledger.
 *
 * A key is `kind:path:symbol` and carries no line number, ever: a line number
 * would churn on every reformat and on every edit above a symbol, and a baseline
 * that churns is a baseline nobody reads before regenerating.
 *
 * The value is the date the checker first saw the finding. That is a second,
 * git-independent age channel — exact from the day the entry was recorded, and
 * immune to every `git log -S` failure mode in attribution.ts.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { type Finding, findingKey } from "./analyze.ts";

export const BASELINE_VERSION = 1;

const BaselineSchema = Schema.Struct({
  version: Schema.Number,
  generatedAt: Schema.String,
  findings: Schema.Record(Schema.String, Schema.String),
});

export type Baseline = typeof BaselineSchema.Type;

const decodeBaseline = Schema.decodeUnknownEffect(Schema.fromJsonString(BaselineSchema));

export const emptyBaseline: Baseline = {
  version: BASELINE_VERSION,
  generatedAt: "1970-01-01",
  findings: {},
};

interface BaselineClassification {
  /** Findings already recorded in the baseline, with the date they were recorded. */
  readonly known: ReadonlyArray<{ readonly finding: Finding; readonly since: string }>;
  /** Findings absent from the baseline. Candidates for blocking. */
  readonly added: ReadonlyArray<Finding>;
  /** Baseline keys that are no longer findings — someone deleted dead code. */
  readonly fixed: ReadonlyArray<string>;
}

/**
 * `wasDetectable` guards the `fixed` list. In hook mode the oxlint channel only
 * looks at the staged files, so every `unused-local` entry for an untouched file
 * would otherwise read as fixed and the hook would nag on every commit.
 */
export const classifyAgainstBaseline = (
  findings: ReadonlyArray<Finding>,
  baseline: Baseline,
  wasDetectable: (key: string) => boolean = () => true,
): BaselineClassification => {
  const known: Array<{ finding: Finding; since: string }> = [];
  const added: Array<Finding> = [];
  const live = new Set<string>();

  for (const finding of findings) {
    const key = findingKey(finding);
    live.add(key);
    const since = baseline.findings[key];
    if (since === undefined) added.push(finding);
    else known.push({ finding, since });
  }

  const fixed = Object.keys(baseline.findings)
    .filter((key) => !live.has(key) && wasDetectable(key))
    .toSorted((left, right) => left.localeCompare(right));

  return { known, added, fixed };
};

/** Persisting entries keep their original `since`; new ones get `today`. */
export const mergeBaseline = (
  findings: ReadonlyArray<Finding>,
  previous: Baseline,
  today: string,
): Baseline => {
  const merged: Record<string, string> = {};
  for (const key of findings.map(findingKey).toSorted((left, right) => left.localeCompare(right))) {
    merged[key] = previous.findings[key] ?? today;
  }
  return { version: BASELINE_VERSION, generatedAt: today, findings: merged };
};

/** Two-space JSON with a trailing newline, i.e. exactly what oxfmt would produce. */
export const serializeBaseline = (baseline: Baseline): string =>
  `${JSON.stringify(baseline, undefined, 2)}\n`;

/**
 * A missing or corrupt baseline must never block: without it every pre-existing
 * finding in the repo would read as new and no commit could land.
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
