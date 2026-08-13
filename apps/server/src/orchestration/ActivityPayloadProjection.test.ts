import { EventId, TurnId, type OrchestrationThreadActivity } from "@vide/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectActivityPayload } from "./ActivityPayloadProjection.ts";

describe("activity payload transport projection", () => {
  it("keeps final tool evidence intact for live and historical clients", () => {
    const payload = {
      itemType: "command_execution",
      toolCallId: "call-1",
      data: {
        item: {
          type: "commandExecution",
          command: "vp test run focused.test.ts",
          aggregatedOutput: "1 passed\n",
          exitCode: 0,
          durationMs: 842,
          cwd: "/workspace/app",
        },
      },
    };
    const activity: OrchestrationThreadActivity = {
      id: EventId.make("activity-1"),
      tone: "tool",
      kind: "tool.completed",
      summary: "Ran command",
      payload,
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-08-05T12:00:00.000Z",
    };

    const projected = projectActivityPayload(activity);

    expect(projected).toBe(activity);
    expect(projected.payload).toBe(payload);
    expect(projected.payload).toEqual(payload);
  });
});
