#!/usr/bin/env node

/*
 * `vp fmt` wrapper for the `staged` task in the root `vite.config.ts`.
 *
 * Oxfmt exits non-zero with "Expected at least one target file" when none of the
 * paths it was handed is a language it can format. `vp staged` passes the whole
 * staged set, so a commit that touches only binaries, only a `.py`, or only an
 * extensionless file was refused outright — which is what forced `--no-verify`
 * twice in a previous session.
 *
 * A mixed set was always fine: `vp fmt build-icons.py vite.config.ts` formats the
 * one file it understands and exits 0. Only an *entirely* unformattable staged set
 * fails.
 *
 * Narrowing the staged glob instead was rejected: `"*.*"` still breaks on `.py`
 * and `.png`, and an explicit extension allowlist silently skips dotfiles
 * (`*.json` does not match `.oxlintrc.json`) and rots whenever oxfmt learns a new
 * language. This wrapper knows nothing about which extensions oxfmt supports, so
 * it cannot drift out of sync with it.
 *
 * Arguments are taken straight from argv rather than through `effect/unstable/cli`
 * on purpose: every argument is a path chosen by git, and a path must never be
 * reinterpreted as a flag.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { runProcess } from "./lib/run-process.ts";

/**
 * Oxfmt's message when every path it was given is a language it cannot format.
 * Matched loosely on purpose: if the wording changes, the worst case is that the
 * original failure surfaces again — never that a real formatting error is hidden.
 */
const NOTHING_TO_FORMAT = /expected at least one target file/i;

export const isNothingToFormatFailure = (result: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}): boolean => result.exitCode !== 0 && NOTHING_TO_FORMAT.test(`${result.stdout}${result.stderr}`);

const formatStagedFiles = Effect.fn("formatStagedFiles")(function* (files: ReadonlyArray<string>) {
  if (files.length === 0) return 0;

  const result = yield* runProcess("vp", ["fmt", ...files]);
  if (isNothingToFormatFailure(result)) return 0;

  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  return result.exitCode;
});

if (import.meta.main) {
  formatStagedFiles(process.argv.slice(2)).pipe(
    Effect.tap((exitCode) =>
      Effect.sync(() => {
        process.exitCode = exitCode;
      }),
    ),
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
