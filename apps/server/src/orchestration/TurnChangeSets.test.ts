import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@vide/contracts";
import { describe, expect, it } from "vite-plus/test";

import { TurnChangeSetAssembler } from "./TurnChangeSets.ts";

const threadId = ThreadId.make("thread-1");
const turnId = TurnId.make("turn-1");
const provider = ProviderDriverKind.make("test");
const createdAt = "2026-08-05T12:00:00.000Z";

function event<T extends ProviderRuntimeEvent>(value: T): T {
  return value;
}

function base(eventId: string) {
  return {
    eventId: EventId.make(eventId),
    provider,
    threadId,
    turnId,
    createdAt,
  } as const;
}

describe("TurnChangeSetAssembler", () => {
  it("keeps a read-only turn empty when the ambient worktree changed elsewhere", () => {
    const assembler = new TurnChangeSetAssembler();
    assembler.observe(event({ ...base("started"), type: "turn.started", payload: {} }));

    const result = assembler.complete(
      event({
        ...base("completed"),
        type: "turn.completed",
        payload: { state: "completed" },
      }),
    );

    expect(result).toMatchObject({ source: "none", unifiedDiff: "", files: [] });
  });

  it("uses the provider turn snapshot as the authority", () => {
    const assembler = new TurnChangeSetAssembler();
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    assembler.observe(
      event({ ...base("diff"), type: "turn.diff.updated", payload: { unifiedDiff: diff } }),
    );

    const result = assembler.complete(
      event({
        ...base("completed"),
        type: "turn.completed",
        payload: { state: "completed" },
      }),
    );

    expect(result).toMatchObject({
      source: "provider-turn-diff",
      unifiedDiff: diff,
      files: [{ path: "src/a.ts", additions: 1, deletions: 1 }],
    });
  });

  it("deduplicates structured tool updates by file", () => {
    const assembler = new TurnChangeSetAssembler();
    assembler.observe(
      event({
        ...base("item-1"),
        type: "item.updated",
        itemId: RuntimeItemId.make("item-1"),
        payload: {
          itemType: "file_change",
          fileChanges: [{ path: "src/a.ts", additions: 1, deletions: 0, patch: "first" }],
        },
      }),
    );
    assembler.observe(
      event({
        ...base("item-2"),
        type: "item.completed",
        itemId: RuntimeItemId.make("item-1"),
        payload: {
          itemType: "file_change",
          fileChanges: [{ path: "src/a.ts", additions: 2, deletions: 1, patch: "latest" }],
        },
      }),
    );

    const result = assembler.complete(
      event({
        ...base("completed"),
        type: "turn.completed",
        payload: { state: "completed" },
      }),
    );

    expect(result).toMatchObject({
      source: "structured-file-mutations",
      unifiedDiff: "latest",
      files: [{ path: "src/a.ts", additions: 2, deletions: 1 }],
    });
  });

  it("preserves sequential edits to the same file from different tool calls", () => {
    const assembler = new TurnChangeSetAssembler();
    for (const [itemId, patch] of [
      ["item-1", "first patch"],
      ["item-2", "second patch"],
    ] as const) {
      assembler.observe(
        event({
          ...base(itemId),
          type: "item.completed",
          itemId: RuntimeItemId.make(itemId),
          payload: {
            itemType: "file_change",
            fileChanges: [{ path: "src/a.ts", additions: 1, deletions: 1, patch }],
          },
        }),
      );
    }

    const result = assembler.complete(
      event({
        ...base("completed-after-two-edits"),
        type: "turn.completed",
        payload: { state: "completed" },
      }),
    );

    expect(result).toMatchObject({
      unifiedDiff: "first patch\nsecond patch",
      files: [{ path: "src/a.ts", additions: 2, deletions: 2 }],
    });
  });
});
