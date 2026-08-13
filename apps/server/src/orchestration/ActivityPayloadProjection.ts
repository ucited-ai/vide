import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@vide/contracts";

/**
 * The activity itself is already the canonical, persisted provider projection:
 * it does not contain the raw SDK/app-server frame. Tool consumers now need the
 * final command output, diffs, search results, and structured MCP result, so a
 * second lossy projection at the WebSocket boundary would make both live and
 * historical detail views dishonest.
 */
export function projectActivityPayload(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  return activity;
}

export function projectThreadDetailSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
): OrchestrationThreadDetailSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      activities: snapshot.thread.activities.map(projectActivityPayload),
    },
  };
}

export function projectActivityEvent(event: OrchestrationEvent): OrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return event;
  }
  return {
    ...event,
    payload: {
      ...event.payload,
      activity: projectActivityPayload(event.payload.activity),
    },
  };
}
