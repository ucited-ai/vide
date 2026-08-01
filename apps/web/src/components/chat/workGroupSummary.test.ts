import { describe, expect, it } from "vite-plus/test";

import { type WorkLogEntry } from "../../session-logic";
import { summarizeWorkGroup } from "./workGroupSummary";

function entry(overrides: Partial<WorkLogEntry>): WorkLogEntry {
  return {
    id: `work-${String(Math.abs(Object.keys(overrides).length))}-${overrides.label ?? "x"}`,
    createdAt: "2026-01-01T00:00:00Z",
    label: "Worked",
    tone: "tool",
    ...overrides,
  };
}

describe("summarizeWorkGroup", () => {
  it("names what the calls did rather than counting them", () => {
    expect(
      summarizeWorkGroup([
        entry({ label: "Read", requestKind: "file-read" }),
        entry({ label: "Read", requestKind: "file-read" }),
        entry({ label: "Read", requestKind: "file-read" }),
      ]),
    ).toBe("Read 3 files");
  });

  it("reads several kinds of work out as one sentence", () => {
    expect(
      summarizeWorkGroup([
        entry({ label: "Read", requestKind: "file-read" }),
        entry({ label: "Patch", itemType: "file_change", changedFiles: ["a.ts", "b.ts"] }),
        entry({ label: "Test", command: "vp test run" }),
      ]),
    ).toBe("Read 1 file · edited 2 files · ran 1 command");
  });

  it("counts the files a patch touched, not the patches", () => {
    expect(
      summarizeWorkGroup([
        entry({ label: "Patch", itemType: "file_change", changedFiles: ["a.ts"] }),
        entry({ label: "Patch", itemType: "file_change", changedFiles: ["a.ts"] }),
      ]),
      // Two hunks of one file are two edits, and claiming "2 files" would be a lie.
    ).toBe("Edited 2 files");
    expect(
      summarizeWorkGroup([
        entry({ label: "Patch", itemType: "file_change", changedFiles: ["a.ts", "b.ts", "c.ts"] }),
      ]),
    ).toBe("Edited 3 files");
  });

  it("keeps a note out of the tool-call count", () => {
    expect(summarizeWorkGroup([entry({ label: "Context compacted", tone: "info" })])).toBe(
      "1 log entry",
    );
  });

  it("says something for a group with nothing in it", () => {
    expect(summarizeWorkGroup([])).toBe("Worked");
  });

  it("keeps the singular", () => {
    expect(summarizeWorkGroup([entry({ label: "Read", requestKind: "file-read" })])).toBe(
      "Read 1 file",
    );
    expect(summarizeWorkGroup([entry({ label: "Search", itemType: "web_search" })])).toBe(
      "Searched the web",
    );
  });
});
