import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@vide/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      pinned: false,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

it.layer(NodeServices.layer)("pinned thread decider", (it) => {
  it.effect("emits pin and unpin lifecycle events", () =>
    Effect.gen(function* () {
      const pinned = yield* decideOrchestrationCommand({
        command: {
          type: "thread.pin",
          commandId: CommandId.make("cmd-pin"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel,
      });
      const unpinned = yield* decideOrchestrationCommand({
        command: {
          type: "thread.unpin",
          commandId: CommandId.make("cmd-unpin"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel,
      });

      const pinnedEvents = Array.isArray(pinned) ? pinned : [pinned];
      const unpinnedEvents = Array.isArray(unpinned) ? unpinned : [unpinned];
      expect(pinnedEvents[0]?.type).toBe("thread.pinned");
      expect(unpinnedEvents[0]?.type).toBe("thread.unpinned");
    }),
  );
});
