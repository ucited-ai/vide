import { assert, describe, it } from "@effect/vitest";

import {
  BULK_COMMIT_FILE_THRESHOLD,
  diffRemovesSymbol,
  parseCommitLines,
  parseFilesChanged,
} from "./attribution.ts";
import { parseUnusedLocals } from "./lint.ts";

describe("dead-code/attribution", () => {
  it("parses the tab-separated commit format, keeping tabs inside subjects", () => {
    const parsed = parseCommitLines(
      "abc123\t2026-02-15\tAdd project script actions\ndef456\t2026-07-30\tTrim\tthe header\n",
    );

    assert.deepStrictEqual(parsed, [
      { hash: "abc123", date: "2026-02-15", subject: "Add project script actions" },
      { hash: "def456", date: "2026-07-30", subject: "Trim\tthe header" },
    ]);
  });

  it("reads the file count that decides whether a commit is mechanical", () => {
    assert.strictEqual(
      parseFilesChanged(" 14992 files changed, 8951 insertions(+), 1992078 deletions(-)"),
      14992,
    );
    assert.strictEqual(parseFilesChanged(" 1 file changed, 2 insertions(+)"), 1);
    assert.strictEqual(parseFilesChanged("nothing here"), 0);
    // The two bulk commits in this history are 14992 and 11742 files; the next
    // largest in the last 120 commits is two orders of magnitude smaller.
    assert.isBelow(BULK_COMMIT_FILE_THRESHOLD, 11_742);
  });

  it("confirms a removal only on a word-anchored match, so -S substring hits are filtered", () => {
    const diff = [
      "--- a/apps/web/src/components/ChatView.tsx",
      "+++ b/apps/web/src/components/ChatView.tsx",
      "-            onAddProjectScript={saveProjectScript}",
    ].join("\n");

    assert.isTrue(diffRemovesSymbol(diff, "saveProjectScript"));
    // `useTheme` must not be confirmed by a line that only removes `useThemeSync`.
    assert.isFalse(diffRemovesSymbol("-const x = useThemeSync();", "useTheme"));
    assert.isTrue(diffRemovesSymbol("-const x = useTheme();", "useTheme"));
    // The `---` header line is not a removal.
    assert.isFalse(diffRemovesSymbol("--- a/saveProjectScript.ts", "saveProjectScript"));
    // An added line is not a removal.
    assert.isFalse(diffRemovesSymbol("+const x = useTheme();", "useTheme"));
  });

  it("handles hyphenated CSS custom properties in diff confirmation", () => {
    assert.isTrue(diffRemovesSymbol("-  color: var(--fixture-step-2);", "--fixture-step-2"));
    assert.isFalse(diffRemovesSymbol("-  color: var(--fixture-step-20);", "--fixture-step-2"));
  });
});

describe("dead-code/lint", () => {
  it("turns oxlint's unused-variable diagnostics into findings", () => {
    const findings = parseUnusedLocals([
      {
        message: "Variable 'saveProjectScript' is declared but never used.",
        code: "eslint(no-unused-vars)",
        filename: "apps/web/src/components/ChatView.tsx",
        labels: [{ span: { line: 2984 } }],
      },
      {
        message: "Parameter 'event' is declared but never used.",
        code: "eslint(no-unused-vars)",
        filename: "apps/web/src/a.ts",
      },
      {
        message: "Do not define components during render.",
        code: "react(no-unstable-nested-components)",
        filename: "apps/web/src/b.tsx",
      },
    ]);

    assert.deepStrictEqual(
      findings.map((finding) => [finding.kind, finding.symbol, finding.detail, finding.severity]),
      [["unused-local", "saveProjectScript", "declared at line 2984, never read", "block"]],
    );
  });
});
