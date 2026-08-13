import {
  type RuntimeEventRawSource,
  RuntimeItemId,
  type CanonicalRequestType,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ProviderFileMutation,
  type ProviderRuntimeEvent,
  type RuntimeRequestId,
  type ThreadId,
  type ToolLifecycleItemType,
  type TurnId,
} from "@vide/contracts";

import type { AcpPermissionRequest, AcpPlanUpdate, AcpToolCallState } from "./AcpRuntimeModel.ts";

type AcpAdapterRawSource = Extract<
  RuntimeEventRawSource,
  "acp.jsonrpc" | `acp.${string}.extension`
>;

interface AcpEventStamp {
  readonly eventId: EventId;
  readonly createdAt: string;
}

type AcpCanonicalRequestType = Extract<
  CanonicalRequestType,
  "exec_command_approval" | "file_read_approval" | "file_change_approval" | "unknown"
>;

function canonicalRequestTypeFromAcpKind(kind: string | "unknown"): AcpCanonicalRequestType {
  switch (kind) {
    case "execute":
      return "exec_command_approval";
    case "read":
      return "file_read_approval";
    case "edit":
    case "delete":
    case "move":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function canonicalItemTypeFromAcpToolKind(kind: string | undefined): ToolLifecycleItemType {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "search":
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function runtimeItemStatusFromAcpToolStatus(
  status: AcpToolCallState["status"],
): "inProgress" | "completed" | "failed" | undefined {
  switch (status) {
    case "pending":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(
  records: ReadonlyArray<Record<string, unknown> | undefined>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function patchLineStats(patch: string): { readonly additions: number; readonly deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function ensureUnifiedPatch(
  path: string,
  patch: string,
  kind: ProviderFileMutation["kind"],
): string {
  const trimmed = patch.trim();
  if (trimmed.startsWith("diff --git ")) return trimmed;
  const beforePath = kind === "created" ? "/dev/null" : `a/${path}`;
  const afterPath = kind === "deleted" ? "/dev/null" : `b/${path}`;
  return [`diff --git a/${path} b/${path}`, `--- ${beforePath}`, `+++ ${afterPath}`, trimmed].join(
    "\n",
  );
}

function fileMutationsFromAcpToolCall(
  toolCall: AcpToolCallState,
): ReadonlyArray<ProviderFileMutation> | undefined {
  if (toolCall.kind !== "edit" && toolCall.kind !== "delete" && toolCall.kind !== "move") {
    return undefined;
  }

  const rawInput = isRecord(toolCall.data.rawInput) ? toolCall.data.rawInput : undefined;
  const rawOutput = isRecord(toolCall.data.rawOutput) ? toolCall.data.rawOutput : undefined;
  const records = [rawOutput, rawInput, toolCall.data] as const;
  const locationPaths = Array.isArray(toolCall.data.locations)
    ? toolCall.data.locations.flatMap((location) => {
        if (!isRecord(location)) return [];
        const path = firstString([location], ["path"]);
        return path ? [path] : [];
      })
    : [];
  const directPath = firstString(records, [
    "new_path",
    "newPath",
    "destination_path",
    "destinationPath",
    "file_path",
    "filePath",
    "filename",
    "path",
  ]);
  const previousPath = firstString(records, ["old_path", "oldPath", "source_path", "sourcePath"]);
  const paths = [
    ...new Set([directPath, ...locationPaths].filter((path): path is string => !!path)),
  ];
  if (paths.length === 0) return undefined;

  const kind =
    toolCall.kind === "delete" ? "deleted" : toolCall.kind === "move" ? "moved" : "modified";
  const rawPatch = firstString(records, ["patch", "diff", "unifiedDiff", "unified_diff"]);
  const additions = nonNegativeInteger(rawOutput?.additions ?? rawInput?.additions);
  const deletions = nonNegativeInteger(rawOutput?.deletions ?? rawInput?.deletions);

  return paths.map((path) => {
    const patch = rawPatch ? ensureUnifiedPatch(path, rawPatch, kind) : undefined;
    const stats = patch ? patchLineStats(patch) : undefined;
    return {
      path,
      ...(kind === "moved" && previousPath && previousPath !== path ? { previousPath } : {}),
      kind,
      ...(patch ? { patch } : {}),
      ...(additions !== undefined ? { additions } : stats ? { additions: stats.additions } : {}),
      ...(deletions !== undefined ? { deletions } : stats ? { deletions: stats.deletions } : {}),
    } satisfies ProviderFileMutation;
  });
}

export function makeAcpRequestOpenedEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly requestId: RuntimeRequestId;
  readonly permissionRequest: AcpPermissionRequest;
  readonly detail: string;
  readonly args: unknown;
  readonly source: AcpAdapterRawSource;
  readonly method: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "request.opened",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    requestId: input.requestId,
    payload: {
      requestType: canonicalRequestTypeFromAcpKind(input.permissionRequest.kind),
      detail: input.detail,
      args: input.args,
    },
    raw: {
      source: input.source,
      method: input.method,
      payload: input.rawPayload,
    },
  };
}

export function makeAcpRequestResolvedEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly requestId: RuntimeRequestId;
  readonly permissionRequest: AcpPermissionRequest;
  readonly decision: ProviderApprovalDecision;
}): ProviderRuntimeEvent {
  return {
    type: "request.resolved",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    requestId: input.requestId,
    payload: {
      requestType: canonicalRequestTypeFromAcpKind(input.permissionRequest.kind),
      decision: input.decision,
    },
  };
}

export function makeAcpPlanUpdatedEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly payload: AcpPlanUpdate;
  readonly source: AcpAdapterRawSource;
  readonly method: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "turn.plan.updated",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: input.payload,
    raw: {
      source: input.source,
      method: input.method,
      payload: input.rawPayload,
    },
  };
}

export function makeAcpToolCallEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly toolCall: AcpToolCallState;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  const runtimeStatus = runtimeItemStatusFromAcpToolStatus(input.toolCall.status);
  const fileChanges = fileMutationsFromAcpToolCall(input.toolCall);
  return {
    type:
      input.toolCall.status === "completed" || input.toolCall.status === "failed"
        ? "item.completed"
        : "item.updated",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.toolCall.toolCallId),
    payload: {
      itemType: canonicalItemTypeFromAcpToolKind(input.toolCall.kind),
      ...(runtimeStatus ? { status: runtimeStatus } : {}),
      ...(input.toolCall.title ? { title: input.toolCall.title } : {}),
      ...(input.toolCall.detail ? { detail: input.toolCall.detail } : {}),
      ...(fileChanges ? { fileChanges } : {}),
      ...(Object.keys(input.toolCall.data).length > 0 ? { data: input.toolCall.data } : {}),
    },
    raw: {
      source: "acp.jsonrpc",
      method: "session/update",
      payload: input.rawPayload,
    },
  };
}

export function makeAcpAssistantItemEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly itemId: string;
  readonly lifecycle: "item.started" | "item.completed";
}): ProviderRuntimeEvent {
  return {
    type: input.lifecycle,
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.itemId),
    payload: {
      itemType: "assistant_message",
      status: input.lifecycle === "item.completed" ? "completed" : "inProgress",
    },
  };
}

export function makeAcpContentDeltaEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly itemId?: string;
  readonly text: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "content.delta",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
    payload: {
      streamKind: "assistant_text",
      delta: input.text,
    },
    raw: {
      source: "acp.jsonrpc",
      method: "session/update",
      payload: input.rawPayload,
    },
  };
}
