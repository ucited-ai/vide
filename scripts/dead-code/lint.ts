/*
 * The file-local dead-code channel, taken from oxlint rather than reimplemented.
 *
 * `eslint(no-unused-vars)` is already enabled by the `correctness` category in the
 * root `vite.config.ts` and it is AST-accurate, which no textual scan can be. It is
 * also the channel that reports the four unreachable functions in ChatView.tsx.
 *
 * Writing an oxlint plugin rule for cross-file dead code was considered and
 * rejected: oxlint JS plugins are per-file with no cross-file resolution, so such a
 * rule could only duplicate this one or fail to see the references it needs.
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { runProcess } from "../lib/run-process.ts";
import type { Finding } from "./analyze.ts";

const OxlintSpan = Schema.Struct({ line: Schema.Number });

const OxlintDiagnostic = Schema.Struct({
  message: Schema.String,
  code: Schema.String,
  filename: Schema.String,
  labels: Schema.optional(Schema.Array(Schema.Struct({ span: Schema.optional(OxlintSpan) }))),
});

const OxlintReport = Schema.Struct({ diagnostics: Schema.Array(OxlintDiagnostic) });

const decodeOxlintReport = Schema.decodeUnknownEffect(Schema.fromJsonString(OxlintReport));

const EMPTY: ReadonlyArray<Finding> = [];

const UNUSED_VARS_CODE = "eslint(no-unused-vars)";

/**
 * An unused *parameter* is signature-shaped, not orphaned code, so it is skipped.
 * Everything else oxlint calls unused is a declaration nobody reads.
 */
const SKIPPED_MESSAGE_SUBJECTS = ["Parameter", "Catch"];

export const parseUnusedLocals = (
  diagnostics: ReadonlyArray<{
    readonly message: string;
    readonly code: string;
    readonly filename: string;
    readonly labels?:
      | ReadonlyArray<{ readonly span?: { readonly line: number } | undefined }>
      | undefined;
  }>,
): ReadonlyArray<Finding> =>
  diagnostics.flatMap((diagnostic) => {
    if (diagnostic.code !== UNUSED_VARS_CODE) return [];
    if (SKIPPED_MESSAGE_SUBJECTS.some((subject) => diagnostic.message.startsWith(subject))) {
      return [];
    }
    const symbol = /'([^']+)'/.exec(diagnostic.message)?.[1];
    if (symbol === undefined) return [];
    const line = diagnostic.labels?.[0]?.span?.line;
    return [
      {
        kind: "unused-local",
        path: diagnostic.filename.replaceAll("\\", "/"),
        symbol,
        detail:
          line === undefined ? "declared, never read" : `declared at line ${line}, never read`,
        severity: "block",
      } satisfies Finding,
    ];
  });

/**
 * Lints the given paths, or the whole repo when `paths` is empty. Never fails: if
 * oxlint cannot run, the channel degrades to nothing rather than blocking a commit.
 */
export const collectUnusedLocals = Effect.fn("collectUnusedLocals")(function* (
  paths: ReadonlyArray<string>,
  cwd: string,
) {
  const result = yield* runProcess("vp", ["lint", ...paths, "--format", "json"], { cwd }).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  if (result === undefined) return { findings: EMPTY, problem: "could not run `vp lint`" };

  const report = yield* decodeOxlintReport(result.stdout).pipe(Effect.option);
  if (report._tag === "None") {
    return { findings: EMPTY, problem: "could not parse `vp lint --format json` output" };
  }
  return { findings: parseUnusedLocals(report.value.diagnostics), problem: undefined };
});
