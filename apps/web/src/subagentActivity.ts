import type { OrchestrationThreadActivity, ProviderAgentAttribution } from "@vide/contracts";

import type { WorkLogEntry } from "./session-logic";
import type { ChatMessage } from "./types";

export type SubagentStatus = "running" | "finished" | "failed";

export interface SubagentSummary {
  readonly agent: ProviderAgentAttribution;
  readonly name: string;
  readonly status: SubagentStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly toolCallCount: number;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly workEntries: ReadonlyArray<WorkLogEntry>;
  readonly finalText: string | null;
  readonly colorIndex: number;
}

interface MutableSubagent {
  agent: ProviderAgentAttribution;
  startedAt: string;
  finishedAt: string | null;
  status: SubagentStatus;
  stateMessage: string | null;
  messages: ChatMessage[];
  workEntries: WorkLogEntry[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function minIso(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right;
}

function maxIso(left: string | null, right: string): string {
  return left === null || right.localeCompare(left) > 0 ? right : left;
}

function richerAgent(
  current: ProviderAgentAttribution,
  incoming: ProviderAgentAttribution,
): ProviderAgentAttribution {
  return {
    ...current,
    ...incoming,
    agentId: current.agentId,
    ...((incoming.name ?? current.name) ? { name: incoming.name ?? current.name } : {}),
    ...((incoming.path ?? current.path) ? { path: incoming.path ?? current.path } : {}),
  };
}

function agentName(agent: ProviderAgentAttribution, index: number): string {
  const pathName = agent.path?.split("/").findLast((segment) => segment.length > 0);
  return agent.name ?? pathName ?? `Agent ${String(index + 1)}`;
}

function stableColorIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 6;
}

function statusFromProvider(value: unknown): SubagentStatus | null {
  const normalized = trimmed(value)?.toLowerCase();
  if (!normalized) return null;
  if (["completed", "complete", "finished", "success", "shutdown"].includes(normalized)) {
    return "finished";
  }
  if (["failed", "errored", "error", "interrupted", "stopped", "notfound"].includes(normalized)) {
    return "failed";
  }
  if (["pendinginit", "pending", "running", "inprogress"].includes(normalized)) {
    return "running";
  }
  return null;
}

function durationBetween(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  return Number.isFinite(start) && Number.isFinite(finish) ? Math.max(0, finish - start) : null;
}

/**
 * Builds the small public identity for each child from both provider shapes.
 * Claude contributes task lifecycle activities; Codex contributes receiver
 * thread ids and agent states. Child text and work stay attached to that
 * identity and can therefore be omitted from the parent timeline.
 */
export function deriveSubagentSummaries(input: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly workEntries: ReadonlyArray<WorkLogEntry>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}): SubagentSummary[] {
  const byId = new Map<string, MutableSubagent>();
  const ensure = (agent: ProviderAgentAttribution, createdAt: string): MutableSubagent => {
    const existing = byId.get(agent.agentId);
    if (existing) {
      existing.agent = richerAgent(existing.agent, agent);
      existing.startedAt = minIso(existing.startedAt, createdAt);
      return existing;
    }
    const created: MutableSubagent = {
      agent,
      startedAt: createdAt,
      finishedAt: null,
      status: "running",
      stateMessage: null,
      messages: [],
      workEntries: [],
    };
    byId.set(agent.agentId, created);
    return created;
  };

  for (const activity of input.activities) {
    if (activity.agent) {
      const child = ensure(activity.agent, activity.createdAt);
      if (activity.kind === "task.completed") {
        const payload = asRecord(activity.payload);
        const status = statusFromProvider(payload?.status) ?? "finished";
        child.status = status;
        child.finishedAt = maxIso(child.finishedAt, activity.createdAt);
        child.stateMessage = trimmed(payload?.summary) ?? trimmed(payload?.detail);
      }
    }

    const payload = asRecord(activity.payload);
    const data = asRecord(payload?.data);
    const item = asRecord(data?.item);
    if (item?.type !== "collabAgentToolCall") continue;
    const receiverIds = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const states = asRecord(item.agentsStates);
    for (const agentId of new Set([...receiverIds, ...Object.keys(states ?? {})])) {
      const child = ensure(
        {
          agentId,
          parentToolUseId: trimmed(item.id) ?? undefined,
          providerThreadId: agentId,
        },
        activity.createdAt,
      );
      const state = asRecord(states?.[agentId]);
      const status = statusFromProvider(state?.status);
      if (status) child.status = status;
      const message = trimmed(state?.message);
      if (message) child.stateMessage = message;
      if (status === "finished" || status === "failed") {
        child.finishedAt = maxIso(child.finishedAt, activity.createdAt);
      }
    }
  }

  for (const message of input.messages) {
    if (!message.agent) continue;
    const child = ensure(message.agent, message.createdAt);
    child.messages.push(message);
  }
  for (const entry of input.workEntries) {
    if (!entry.agent) continue;
    const child = ensure(entry.agent, entry.createdAt);
    child.workEntries.push(entry);
  }

  return [...byId.values()]
    .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((child, index) => {
      const messages = child.messages.toSorted((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      const workEntries = child.workEntries.toSorted((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      const finalText =
        messages
          .toReversed()
          .map((message) => trimmed(message.text))
          .find((text): text is string => text !== null) ?? child.stateMessage;
      return {
        agent: child.agent,
        name: agentName(child.agent, index),
        status: child.status,
        startedAt: child.startedAt,
        finishedAt: child.finishedAt,
        durationMs: durationBetween(child.startedAt, child.finishedAt),
        toolCallCount: workEntries.filter(
          (entry) => entry.itemType && entry.itemType !== "collab_agent_tool_call",
        ).length,
        messages,
        workEntries,
        finalText,
        colorIndex: stableColorIndex(child.agent.agentId),
      };
    });
}
