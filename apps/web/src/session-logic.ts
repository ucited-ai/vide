import * as Option from "effect/Option";
import * as Arr from "effect/Array";
import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type ProviderAgentAttribution,
  type OrchestrationProposedPlanId,
  ProviderDriverKind,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type ThreadId,
  type TurnId,
} from "@vide/contracts";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  Thread,
  ThreadSession,
  TurnDiffSummary,
} from "./types";

export type ProviderPickerKind = ProviderDriverKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
  /** Shown on the model picker sidebar when relevant */
  pickerSidebarBadge?: "new" | "soon";
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    available: true,
    pickerSidebarBadge: "new",
  },
];

export type WorkLogToolLifecycleStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "declined"
  | "stopped";

export type WorkLogFileStatus = "created" | "modified" | "deleted" | "moved";

export interface WorkLogFileChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly status?: WorkLogFileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly diff?: string;
}

export interface WorkLogCommandDetails {
  readonly output?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly cwd?: string;
}

export interface WorkLogWebSource {
  readonly url: string;
  readonly title?: string;
}

export interface WorkLogWebSearchDetails {
  readonly query?: string;
  readonly action?: unknown;
  readonly sources: ReadonlyArray<WorkLogWebSource>;
}

export interface WorkLogMcpDetails {
  readonly server?: string;
  readonly tool?: string;
  readonly arguments?: unknown;
  readonly result?: unknown;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  turnId?: TurnId | null;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolData?: unknown;
  commandDetails?: WorkLogCommandDetails;
  fileChanges?: ReadonlyArray<WorkLogFileChange>;
  webSearch?: WorkLogWebSearchDetails;
  mcpDetails?: WorkLogMcpDetails;
  agent?: ProviderAgentAttribution;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  /** From runtime item / task payload `status` when present (e.g. tool.updated). */
  toolLifecycleStatus?: WorkLogToolLifecycleStatus;
  /** Originating orchestration activity kind (e.g. `user-input.requested`) for row chrome. */
  sourceActivityKind?: OrchestrationThreadActivity["kind"];
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  toolCallId?: string;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export function workLogEntryIsToolLike(entry: WorkLogEntry): boolean {
  if (entry.tone === "tool" || entry.tone === "thinking" || entry.tone === "error") {
    return true;
  }
  if (entry.command !== undefined && entry.command.trim().length > 0) {
    return true;
  }
  if (entry.requestKind !== undefined) {
    return true;
  }
  return entry.itemType !== undefined && isToolLifecycleItemType(entry.itemType);
}

/** Heuristic: providers often emit successful lifecycle status while error text lives in `detail` / `command`. */
function toolDetailTextLooksLikeFailure(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("file not found")) {
    return true;
  }
  if (t.includes("no files found")) {
    return true;
  }
  if (
    t.includes("enoent") ||
    t.includes("no such file or directory") ||
    t.includes("no such file")
  ) {
    return true;
  }
  if (t.includes("cannot find path") && t.includes("because it does not exist")) {
    return true;
  }
  if (t.includes("commandnotfoundexception")) {
    return true;
  }
  if (t.includes("is not recognized as the name of a cmdlet")) {
    return true;
  }
  if (t.includes("is not recognized") && t.includes("the term '")) {
    return true;
  }
  if (t.includes("a parameter cannot be found that matches parameter name")) {
    return true;
  }
  if (t.includes("command not found")) {
    return true;
  }
  if (/<exited with exit code\s+[1-9]\d*\s*>/i.test(text)) {
    return true;
  }
  if (/exit(?:ed)? with exit code\s+[1-9]\d*/i.test(text)) {
    return true;
  }
  if (/exit code\s*[:\s]\s*[1-9]\d*\b/i.test(text)) {
    return true;
  }
  return false;
}

/** True when the row should show a failure affordance (explicit status/tone or error-shaped tool output). */
export function workEntryIndicatesToolFailure(entry: WorkLogEntry): boolean {
  if (entry.tone === "error") {
    return true;
  }
  const ls = entry.toolLifecycleStatus;
  if (ls === "failed" || ls === "declined") {
    return true;
  }
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  const parts: string[] = [];
  if (entry.detail) {
    parts.push(entry.detail);
  }
  if (entry.command) {
    parts.push(entry.command);
  }
  const blob = parts.join("\n");
  if (blob.length === 0) {
    return false;
  }
  return toolDetailTextLooksLikeFailure(blob);
}

/** Tool/command row completed without failure (blue check affordance). */
export function workEntryIndicatesToolSuccess(entry: WorkLogEntry): boolean {
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  if (workEntryIndicatesToolFailure(entry)) {
    return false;
  }
  if (entry.tone === "thinking") {
    return false;
  }
  const ls = entry.toolLifecycleStatus;
  if (ls === "failed" || ls === "declined") {
    return false;
  }
  if (ls === "inProgress") {
    return false;
  }
  if (ls === "stopped") {
    return false;
  }
  return true;
}

/** Tool-like row with neither clear success nor failure (empty, incomplete, in progress, etc.). */
export function workEntryIndicatesToolNeutralStatus(entry: WorkLogEntry): boolean {
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  if (workEntryIndicatesToolFailure(entry)) {
    return false;
  }
  if (workEntryIndicatesToolSuccess(entry)) {
    return false;
  }
  return true;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10;
    // 9.95s+ rounds up to the next bucket — render "10s", not "10.0s".
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`;
  }
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<NonNullable<Thread["session"]>, "status" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.status === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  const runningTurnId = session?.status === "running" ? session.activeTurnId : null;
  if (runningTurnId !== null) {
    if (latestTurn?.turnId === runningTurnId) {
      return latestTurn.startedAt ?? sendStartedAt;
    }
    return sendStartedAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request") ||
    normalized.includes("unknown pending user input request") ||
    normalized.includes("unknown pending codex user input request")
  );
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const allPlanActivities = ordered.filter((activity) => activity.kind === "turn.plan.updated");
  // Prefer plan from the current turn; fall back to the most recent plan from any turn
  // so that TodoWrite tasks persist across follow-up messages.
  const latest = Option.firstSomeOf([
    ...(latestTurnId
      ? Arr.findLast(allPlanActivities, (activity) => activity.turnId === latestTurnId)
      : Option.none()),
    Arr.last(allPlanActivities),
  ]).pipe(Option.getOrNull);
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }> = [];
  for (const entry of rawPlan) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.step !== "string") {
      continue;
    }
    const status =
      record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
    steps.push({
      step: record.step,
      status,
    });
  }
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function findSidebarProposedPlan(input: {
  threads: ReadonlyArray<Pick<Thread, "id" | "proposedPlans">>;
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "sourceProposedPlan"> | null;
  latestTurnSettled: boolean;
  threadId: ThreadId | string | null | undefined;
}): LatestProposedPlanState | null {
  const activeThreadPlans =
    input.threads.find((thread) => thread.id === input.threadId)?.proposedPlans ?? [];

  if (!input.latestTurnSettled) {
    const sourceProposedPlan = input.latestTurn?.sourceProposedPlan;
    if (sourceProposedPlan) {
      const sourcePlan = input.threads
        .find((thread) => thread.id === sourceProposedPlan.threadId)
        ?.proposedPlans.find((plan) => plan.id === sourceProposedPlan.planId);
      if (sourcePlan) {
        return toLatestProposedPlanState(sourcePlan);
      }
    }
  }

  return findLatestProposedPlan(activeThreadPlans, input.latestTurn?.turnId ?? null);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const entries: DerivedWorkLogEntry[] = [];
  for (const activity of ordered) {
    if (activity.kind === "task.started") continue;
    if (activity.kind === "context-window.updated") continue;
    if (activity.summary === "Checkpoint captured") continue;
    if (isPlanBoundaryToolActivity(activity)) continue;
    entries.push(toDerivedWorkLogEntry(activity));
  }
  return collapseDerivedWorkLogEntries(entries).map((entry) => {
    const { activityKind, collapseKey: _collapseKey, ...rest } = entry;
    return Object.assign(rest, { sourceActivityKind: activityKind });
  });
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function extractWorkLogToolLifecycleStatus(
  payload: Record<string, unknown> | null,
): WorkLogToolLifecycleStatus | undefined {
  if (!payload) {
    return undefined;
  }
  const s = payload.status;
  if (
    s === "inProgress" ||
    s === "completed" ||
    s === "failed" ||
    s === "declined" ||
    s === "stopped"
  ) {
    return s;
  }
  return undefined;
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandPreview = extractToolCommand(payload);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const isTaskActivity = activity.kind === "task.progress" || activity.kind === "task.completed";
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  const detail = isTaskActivity
    ? !taskDetailAsLabel &&
      payload &&
      typeof payload.detail === "string" &&
      payload.detail.length > 0
      ? stripTrailingExitCode(payload.detail).output
      : null
    : extractToolDetail(payload, title ?? activity.summary);
  const toolCallId = isTaskActivity ? null : extractToolCallId(payload);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    label: taskLabel || activity.summary,
    tone:
      activity.kind === "task.progress"
        ? "thinking"
        : activity.tone === "approval"
          ? "info"
          : activity.tone,
    activityKind: activity.kind,
    ...(activity.agent ? { agent: activity.agent } : {}),
  };
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (detail) {
    entry.detail = detail;
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (title) {
    entry.toolTitle = title;
  }
  const richToolDetails = extractRichToolDetails(payload, itemType);
  if (richToolDetails.toolName) entry.toolName = richToolDetails.toolName;
  if (richToolDetails.input !== undefined) entry.toolInput = richToolDetails.input;
  if (richToolDetails.result !== undefined) entry.toolResult = richToolDetails.result;
  if (richToolDetails.commandDetails) entry.commandDetails = richToolDetails.commandDetails;
  if (richToolDetails.fileChanges.length > 0) {
    entry.fileChanges = richToolDetails.fileChanges;
    entry.changedFiles = [...new Set(richToolDetails.fileChanges.map((change) => change.path))];
  }
  if (richToolDetails.webSearch) entry.webSearch = richToolDetails.webSearch;
  if (richToolDetails.mcpDetails) entry.mcpDetails = richToolDetails.mcpDetails;
  if (itemType === "mcp_tool_call") {
    const data = asRecord(payload?.data);
    if (data?.item !== undefined) {
      entry.toolData = data.item;
    }
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  let toolLifecycleStatus = extractWorkLogToolLifecycleStatus(payload);
  if (!toolLifecycleStatus && activity.kind === "tool.completed") {
    toolLifecycleStatus = "completed";
  }
  if (toolLifecycleStatus) {
    entry.toolLifecycleStatus = toolLifecycleStatus;
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry.collapseKey = collapseKey;
  }
  return entry;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  for (const entry of entries) {
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (
    previous.activityKind !== "tool.started" &&
    previous.activityKind !== "tool.updated" &&
    previous.activityKind !== "tool.completed"
  ) {
    return false;
  }
  if (next.activityKind !== "tool.updated" && next.activityKind !== "tool.completed") {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey) {
    return true;
  }
  if (previous.toolCallId !== undefined && previous.toolCallId === next.toolCallId) {
    return true;
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label)
  );
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const toolLifecycleStatus = next.toolLifecycleStatus ?? previous.toolLifecycleStatus;
  const toolData = next.toolData ?? previous.toolData;
  const toolName = next.toolName ?? previous.toolName;
  const toolInput = next.toolInput ?? previous.toolInput;
  const toolResult = next.toolResult ?? previous.toolResult;
  const lifecycleDurationMs = (() => {
    if (itemType !== "command_execution" || next.activityKind !== "tool.completed") return null;
    const startedAt = Date.parse(previous.createdAt);
    const completedAt = Date.parse(next.createdAt);
    return Number.isFinite(startedAt) && Number.isFinite(completedAt)
      ? Math.max(0, completedAt - startedAt)
      : null;
  })();
  const commandDetails =
    next.commandDetails || previous.commandDetails || lifecycleDurationMs !== null
      ? {
          ...previous.commandDetails,
          ...next.commandDetails,
          ...(next.commandDetails?.durationMs === undefined && lifecycleDurationMs !== null
            ? { durationMs: lifecycleDurationMs }
            : {}),
        }
      : undefined;
  const fileChanges = next.fileChanges ?? previous.fileChanges;
  const webSearch = next.webSearch ?? previous.webSearch;
  const mcpDetails = next.mcpDetails ?? previous.mcpDetails;
  const agent = next.agent ?? previous.agent;
  return {
    ...previous,
    ...next,
    // A completed call keeps the instant it began as its place in the trace.
    createdAt: previous.createdAt,
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolLifecycleStatus !== undefined ? { toolLifecycleStatus } : {}),
    ...(toolData !== undefined ? { toolData } : {}),
    ...(toolName ? { toolName } : {}),
    ...(toolInput !== undefined ? { toolInput } : {}),
    ...(toolResult !== undefined ? { toolResult } : {}),
    ...(commandDetails ? { commandDetails } : {}),
    ...(fileChanges ? { fileChanges } : {}),
    ...(webSearch ? { webSearch } : {}),
    ...(mcpDetails ? { mcpDetails } : {}),
    ...(agent ? { agent } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (entry.activityKind !== "tool.updated" && entry.activityKind !== "tool.completed") {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toolPayloadParts(payload: Record<string, unknown> | null) {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const input = asRecord(data?.input) ?? asRecord(item?.input);
  const result = data?.result ?? item?.result;
  return { data, item, input, result };
}

function textFromToolValue(value: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  const direct = asTrimmedString(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => textFromToolValue(entry, depth + 1))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["text", "stdout", "aggregatedOutput", "output", "content"]) {
    const text = textFromToolValue(record[key], depth + 1);
    if (text) return text;
  }
  return null;
}

function countTextLines(value: string): number {
  if (value.length === 0) return 0;
  return value.split(/\r?\n/u).length;
}

function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function replacementDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  const cellCount = beforeLines.length * afterLines.length;
  if (cellCount > 40_000) {
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${String(beforeLines.length)} +1,${String(afterLines.length)} @@`,
      ...beforeLines.map((line) => `-${line}`),
      ...afterLines.map((line) => `+${line}`),
    ].join("\n");
  }

  const table = Array.from(
    { length: beforeLines.length + 1 },
    () => new Uint32Array(afterLines.length + 1),
  );
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    const row = table[beforeIndex]!;
    const nextRow = table[beforeIndex + 1]!;
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      row[afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? nextRow[afterIndex + 1]! + 1
          : Math.max(nextRow[afterIndex]!, row[afterIndex + 1]!);
    }
  }

  const lines = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${String(beforeLines.length)} +1,${String(afterLines.length)} @@`,
  ];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    if (
      beforeIndex < beforeLines.length &&
      afterIndex < afterLines.length &&
      beforeLines[beforeIndex] === afterLines[afterIndex]
    ) {
      lines.push(` ${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }
    const removeScore = table[beforeIndex + 1]?.[afterIndex] ?? 0;
    const addScore = table[beforeIndex]?.[afterIndex + 1] ?? 0;
    if (beforeIndex < beforeLines.length && removeScore >= addScore) {
      lines.push(`-${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
    } else if (afterIndex < afterLines.length) {
      lines.push(`+${afterLines[afterIndex]}`);
      afterIndex += 1;
    }
  }
  return lines.join("\n");
}

function fileStatusFromCodexKind(kind: Record<string, unknown> | null): {
  status?: WorkLogFileStatus;
  movedTo?: string;
} {
  const type = asTrimmedString(kind?.type);
  if (type === "add") return { status: "created" };
  if (type === "delete") return { status: "deleted" };
  if (type === "update") {
    const movedTo = asTrimmedString(kind?.move_path);
    return movedTo ? { status: "moved", movedTo } : { status: "modified" };
  }
  return {};
}

function extractFileChanges(
  itemType: ToolLifecycleItemType | undefined,
  toolName: string | null,
  item: Record<string, unknown> | null,
  input: Record<string, unknown> | null,
  result: unknown,
): WorkLogFileChange[] {
  if (itemType !== "file_change") return [];

  const codexChanges = Array.isArray(item?.changes) ? item.changes : [];
  const structured = codexChanges.flatMap((value): WorkLogFileChange[] => {
    const change = asRecord(value);
    const originalPath = asTrimmedString(change?.path) ?? asTrimmedString(change?.filename);
    if (!change || !originalPath) return [];
    const kind = fileStatusFromCodexKind(asRecord(change.kind));
    const path = kind.movedTo ?? originalPath;
    const diff = asTrimmedString(change.diff) ?? undefined;
    const stats = diff ? diffStats(diff) : { additions: 0, deletions: 0 };
    return [
      {
        path,
        ...(kind.status ? { status: kind.status } : {}),
        ...(kind.movedTo ? { previousPath: originalPath } : {}),
        ...stats,
        ...(diff ? { diff } : {}),
      },
    ];
  });
  if (structured.length > 0) return structured;

  const normalizedToolName = toolName?.toLowerCase() ?? "";
  const sourcePath =
    asTrimmedString(input?.file_path) ??
    asTrimmedString(input?.path) ??
    asTrimmedString(input?.notebook_path) ??
    asTrimmedString(input?.old_path);
  const targetPath =
    asTrimmedString(input?.new_path) ??
    asTrimmedString(input?.destination) ??
    asTrimmedString(input?.move_path) ??
    sourcePath;
  if (!targetPath) return [];

  const resultText = textFromToolValue(result)?.toLowerCase() ?? "";
  const before = typeof input?.old_string === "string" ? input.old_string : undefined;
  const after =
    typeof input?.new_string === "string"
      ? input.new_string
      : typeof input?.content === "string"
        ? input.content
        : undefined;
  let status: WorkLogFileStatus | undefined;
  if (/delete|remove/u.test(normalizedToolName)) status = "deleted";
  else if (/move|rename/u.test(normalizedToolName)) status = "moved";
  else if (/edit|replace|patch/u.test(normalizedToolName)) status = "modified";
  else if (/create/u.test(normalizedToolName) || /\bcreated\b/u.test(resultText))
    status = "created";
  else if (/\b(modified|updated)\b/u.test(resultText)) status = "modified";

  const diff =
    before !== undefined && after !== undefined
      ? replacementDiff(targetPath, before, after)
      : status === "created" && after !== undefined
        ? [
            `diff --git a/${targetPath} b/${targetPath}`,
            `new file mode 100644`,
            `--- /dev/null`,
            `+++ b/${targetPath}`,
            `@@ -0,0 +1,${String(countTextLines(after))} @@`,
            ...after.split(/\r?\n/u).map((line) => `+${line}`),
          ].join("\n")
        : undefined;
  const stats = diff
    ? diffStats(diff)
    : {
        additions: after === undefined ? 0 : countTextLines(after),
        deletions: before === undefined ? 0 : countTextLines(before),
      };
  return [
    {
      path: targetPath,
      ...(status ? { status } : {}),
      ...(status === "moved" && sourcePath && sourcePath !== targetPath
        ? { previousPath: sourcePath }
        : {}),
      ...stats,
      ...(diff ? { diff } : {}),
    },
  ];
}

function collectWebSources(
  value: unknown,
  target: WorkLogWebSource[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 6 || target.length >= 40) return;
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s<>"')\]]+/gu)) {
      const url = match[0]?.replace(/[.,;:!?]+$/u, "");
      if (url && !seen.has(url)) {
        seen.add(url);
        target.push({ url });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectWebSources(entry, target, seen, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const url = asTrimmedString(record.url) ?? asTrimmedString(record.uri);
  if (url?.startsWith("http") && !seen.has(url)) {
    seen.add(url);
    const title = asTrimmedString(record.title) ?? asTrimmedString(record.name);
    target.push({ url, ...(title ? { title } : {}) });
  }
  for (const nested of Object.values(record)) {
    collectWebSources(nested, target, seen, depth + 1);
  }
}

function extractWebSearchDetails(
  itemType: ToolLifecycleItemType | undefined,
  item: Record<string, unknown> | null,
  input: Record<string, unknown> | null,
  result: unknown,
): WorkLogWebSearchDetails | undefined {
  if (itemType !== "web_search") return undefined;
  const action = item?.action;
  const actionRecord = asRecord(action);
  const actionQueries = Array.isArray(actionRecord?.queries) ? actionRecord.queries : [];
  const query =
    asTrimmedString(item?.query) ??
    asTrimmedString(input?.query) ??
    asTrimmedString(actionRecord?.query) ??
    actionQueries.map(asTrimmedString).find((value): value is string => value !== null);
  const sources: WorkLogWebSource[] = [];
  const seen = new Set<string>();
  collectWebSources(input, sources, seen);
  collectWebSources(action, sources, seen);
  collectWebSources(item?.results, sources, seen);
  collectWebSources(result, sources, seen);
  return {
    ...(query ? { query } : {}),
    ...(action !== undefined ? { action } : {}),
    sources,
  };
}

function extractMcpDetails(
  itemType: ToolLifecycleItemType | undefined,
  toolName: string | null,
  item: Record<string, unknown> | null,
  input: Record<string, unknown> | null,
  result: unknown,
): WorkLogMcpDetails | undefined {
  if (itemType !== "mcp_tool_call") return undefined;
  const mcpNameParts = toolName?.startsWith("mcp__") ? toolName.split("__") : [];
  const server = asTrimmedString(item?.server) ?? asTrimmedString(mcpNameParts[1]);
  const tool = asTrimmedString(item?.tool) ?? asTrimmedString(mcpNameParts.slice(2).join("__"));
  const args = item?.arguments ?? input ?? undefined;
  const mcpResult = item?.result ?? result;
  const error = asTrimmedString(asRecord(item?.error)?.message);
  const durationMs = asNumber(item?.durationMs);
  return {
    ...(server ? { server } : {}),
    ...(tool ? { tool } : {}),
    ...(args !== undefined ? { arguments: args } : {}),
    ...(mcpResult !== undefined && mcpResult !== null ? { result: mcpResult } : {}),
    ...(error ? { error } : {}),
    ...(durationMs !== null ? { durationMs } : {}),
  };
}

function extractCanonicalFileChanges(payload: Record<string, unknown> | null): WorkLogFileChange[] {
  if (!Array.isArray(payload?.fileChanges)) return [];
  return payload.fileChanges.flatMap((value): WorkLogFileChange[] => {
    const change = asRecord(value);
    const path = asTrimmedString(change?.path);
    if (!change || !path) return [];
    const status =
      change.kind === "created" ||
      change.kind === "modified" ||
      change.kind === "deleted" ||
      change.kind === "moved"
        ? change.kind
        : undefined;
    const previousPath = asTrimmedString(change.previousPath) ?? undefined;
    const diff = asTrimmedString(change.patch) ?? undefined;
    return [
      {
        path,
        ...(previousPath ? { previousPath } : {}),
        ...(status ? { status } : {}),
        additions: asNumber(change.additions) ?? 0,
        deletions: asNumber(change.deletions) ?? 0,
        ...(diff ? { diff } : {}),
      },
    ];
  });
}

function extractRichToolDetails(
  payload: Record<string, unknown> | null,
  itemType: ToolLifecycleItemType | undefined,
): {
  toolName: string | null;
  input: unknown;
  result: unknown;
  commandDetails?: WorkLogCommandDetails;
  fileChanges: WorkLogFileChange[];
  webSearch?: WorkLogWebSearchDetails;
  mcpDetails?: WorkLogMcpDetails;
} {
  const { data, item, input, result } = toolPayloadParts(payload);
  const toolName = asTrimmedString(data?.toolName) ?? asTrimmedString(item?.tool);
  const commandOutput =
    asTrimmedString(item?.aggregatedOutput) ??
    (itemType === "command_execution" ? textFromToolValue(result) : null);
  const exitCode = asNumber(item?.exitCode) ?? asNumber(asRecord(result)?.exitCode);
  const durationMs = asNumber(item?.durationMs) ?? asNumber(asRecord(result)?.durationMs);
  const cwd = asTrimmedString(item?.cwd) ?? asTrimmedString(input?.cwd);
  const commandDetails =
    itemType === "command_execution" &&
    (commandOutput || exitCode !== null || durationMs !== null || cwd)
      ? {
          ...(commandOutput ? { output: commandOutput } : {}),
          ...(exitCode !== null ? { exitCode } : {}),
          ...(durationMs !== null ? { durationMs } : {}),
          ...(cwd ? { cwd } : {}),
        }
      : undefined;
  const canonicalFileChanges = extractCanonicalFileChanges(payload);
  const fileChanges =
    canonicalFileChanges.length > 0
      ? canonicalFileChanges
      : extractFileChanges(itemType, toolName, item, input, result);
  const webSearch = extractWebSearchDetails(itemType, item, input, result);
  const mcpDetails = extractMcpDetails(itemType, toolName, item, input, result);
  return {
    toolName,
    input: input ?? undefined,
    result,
    ...(commandDetails ? { commandDetails } : {}),
    fileChanges,
    ...(webSearch ? { webSearch } : {}),
    ...(mcpDetails ? { mcpDetails } : {}),
  };
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts: Array<string> = [];
  for (const entry of value) {
    const part = asTrimmedString(entry);
    if (part !== null) {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input) ?? asRecord(data?.input);
  const itemType = asTrimmedString(payload?.itemType);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  return asTrimmedString(payload?.toolCallId) ?? asTrimmedString(data?.toolCallId);
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(value: string, maxLength = 84): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizePreviewForComparison(value: string | null | undefined): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  return normalizeCompactToolLabel(normalizeInlinePreview(normalized)).toLowerCase();
}

function summarizeToolTextOutput(value: string): string | null {
  const lines: Array<string> = [];
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = normalizeInlinePreview(rawLine);
    if (line.length > 0) {
      lines.push(line);
    }
  }
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return truncateInlinePreview(firstLine);
  }
  if (lines.length > 1) {
    return `${lines.length.toLocaleString()} lines`;
  }
  return null;
}

function summarizeToolRawOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const rawOutput = asRecord(data?.rawOutput);
  if (!rawOutput) {
    return null;
  }

  const totalFiles = asNumber(rawOutput.totalFiles);
  if (totalFiles !== null) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    return summarizeToolTextOutput(content);
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    return summarizeToolTextOutput(stdout);
  }

  return null;
}

function isCommandToolDetail(payload: Record<string, unknown> | null, heading: string): boolean {
  const data = asRecord(payload?.data);
  const kind = asTrimmedString(data?.kind)?.toLowerCase();
  const title = asTrimmedString(payload?.title ?? heading)?.toLowerCase();
  return (
    extractWorkLogItemType(payload) === "command_execution" ||
    kind === "execute" ||
    title === "terminal" ||
    title === "ran command"
  );
}

function extractToolDetail(
  payload: Record<string, unknown> | null,
  heading: string,
): string | null {
  const rawDetail = asTrimmedString(payload?.detail);
  const detail = rawDetail ? stripTrailingExitCode(rawDetail).output : null;
  const normalizedHeading = normalizePreviewForComparison(heading);
  const normalizedDetail = normalizePreviewForComparison(detail);

  if (detail && normalizedHeading !== normalizedDetail) {
    return detail;
  }

  if (isCommandToolDetail(payload, heading)) {
    return null;
  }

  const rawOutputSummary = summarizeToolRawOutput(payload);
  if (rawOutputSummary) {
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (normalizedRawOutputSummary !== normalizedHeading) {
      return rawOutputSummary;
    }
  }

  return null;
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.file_path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);
  pushChangedFile(target, seen, record.move_path);
  pushChangedFile(target, seen, record.old_path);
  pushChangedFile(target, seen, record.new_path);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

export function deriveTimelineEntries(
  messages: ReadonlyArray<ChatMessage>,
  proposedPlans: ReadonlyArray<ProposedPlan>,
  workEntries: ReadonlyArray<WorkLogEntry>,
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function inferCheckpointTurnCountByTurnId(
  summaries: ReadonlyArray<TurnDiffSummary>,
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (
    !session ||
    session.status === "stopped" ||
    session.status === "interrupted" ||
    session.status === "error"
  ) {
    return "disconnected";
  }
  if (session.status === "starting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
