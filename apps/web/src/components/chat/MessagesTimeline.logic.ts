import * as Equal from "effect/Equal";
import {
  formatDuration,
  workEntryIndicatesToolNeutralStatus,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { type SubagentSummary } from "../../subagentActivity";
import {
  type MessageId,
  type OrchestrationLatestTurn,
  type ToolLifecycleItemType,
  type TurnId,
} from "@vide/contracts";

export const TIMELINE_MINIMAP_ITEM_SPACING = 8;
export const TIMELINE_MINIMAP_MIN_ITEMS = 2;
export const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)";
/** `--chat-column-width` as a number, which the minimap's gutter maths needs. */
export const TIMELINE_CONTENT_MAX_WIDTH = 768;
export const TIMELINE_MINIMAP_PERSISTENT_GUTTER = 48;

export interface TimelineEndState {
  readonly isAtEnd?: boolean;
  readonly isNearEnd?: boolean;
}

export interface TimelineEndReport {
  /** The scroll sits at the actual end, to the list's epsilon. */
  readonly atEnd: boolean;
  /** Within LegendList's near-end slack — half a viewport by default. */
  readonly nearEnd: boolean;
}

/**
 * Both readings, because they answer different questions: `nearEnd` is whether
 * an already-running live-follow should survive (content growing under it puts
 * the end briefly out of reach), `atEnd` is whether the reader has actually
 * returned to the end. Collapsing them into one boolean is how "reading two
 * lines above the bottom" used to count as "wants to follow" — and every new
 * delta yanked the reader back down.
 */
export function resolveTimelineEndState(
  state: TimelineEndState | undefined,
): TimelineEndReport | undefined {
  if (!state || (state.isAtEnd === undefined && state.isNearEnd === undefined)) {
    return undefined;
  }
  const atEnd = state.isAtEnd ?? false;
  return { atEnd, nearEnd: state.isNearEnd ?? atEnd };
}

export function resolveTimelineMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`;
}

export function resolveTimelineMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) {
    return 0;
  }
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

export function resolveTimelineMinimapIndexFromPointer(input: {
  readonly itemCount: number;
  readonly railTop: number;
  readonly railHeight: number;
  readonly pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null;
  }
  if (input.itemCount === 1) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))));
}

export function resolveTimelineMinimapHasPersistentGutter(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return sideGutter >= TIMELINE_MINIMAP_PERSISTENT_GUTTER;
}

export const TIMELINE_MINIMAP_HIT_STRIP_LEFT = 12;
export const TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH = 40;
export const TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH = "22rem";

/**
 * The minimap overlays the viewport's left edge while the content column is
 * centered, so the side gutter between them shrinks under browser zoom or a
 * narrow pane. A fixed-width hover strip would then sit on top of the message
 * text and swallow its pointer events. Cap the strip's width so it never
 * extends past the gutter into the content column; 0 disables the strip.
 */
export function resolveTimelineMinimapHitStripWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 0;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return Math.max(
    0,
    Math.min(
      TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH,
      Math.floor(sideGutter) - TIMELINE_MINIMAP_HIT_STRIP_LEFT,
    ),
  );
}

/**
 * Once the preview is open, keep the full preview and the space leading to it
 * interactive. The collapsed strip remains gutter-capped so it cannot block
 * selecting message text.
 */
export function resolveTimelineMinimapInteractiveWidth(
  collapsedWidth: number,
  expanded: boolean,
): number | string {
  return expanded ? TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH : collapsedWidth;
}

function computeElapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
}

export type TimelineLatestTurn = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      /**
       * Every tool call between one piece of commentary and the next.
       *
       * They are one row, not one row each: a turn that read six files should
       * read as "Read 6 files", and the six lines that used to say so are what
       * turned a trace into a log.
       */
      groupedEntries: WorkLogEntry[];
      /** The turn is still running and these are the calls it is making now. */
      live: boolean;
    }
  | {
      /**
       * The turn's one status line, at the top of its own work — static.
       *
       * While the turn runs it reads "Working for" plus a running timer; when
       * the turn settles the same row becomes "Worked for" plus the total, and
       * the work folds behind it. No indicator, no shimmer, no swapping phrase
       * — the animated reading of the turn lives at the bottom, in the
       * `turn-tail` row, where the writing actually happens.
       */
      kind: "turn-head";
      id: string;
      createdAt: string | null;
      turnId: TurnId | null;
      state: "live" | "done";
      /** "Working for", "Worked for", "You stopped after" — the static frame. */
      label: string;
      /** How long the turn took, once it is over. */
      duration: string | null;
      /** What a running turn's timer counts from. */
      startedAt: string | null;
      expanded: boolean;
      /** Whether there is any folded work to reopen. A text-only turn still
          gets its "Worked for" line; it just has no chevron. */
      collapsible: boolean;
      /**
       * One word beside the duration for a turn that did not simply finish —
       * "interrupted", "failed". Where a red banner used to stand over the
       * conversation, the turn now says it in its own line.
       */
      status: string | null;
      /**
       * What went wrong, in full, revealed by opening the head. Kept out of the
       * line itself: the word is the news, the detail is for when it is wanted.
       */
      statusDetail: string | null;
    }
  | {
      /**
       * The bottom of a running turn: the indicator and the phrase the turn is
       * on ("Thinking", "Working", "Writing"), under the newest content —
       * where the reader's eye already is. Exactly one exists at a time; its
       * constant id is what keeps it from remounting when the server assigns
       * the turn its real id.
       */
      kind: "turn-tail";
      id: "turn-tail:live";
      createdAt: string | null;
      label: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showAssistantMeta: boolean;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      /** The turn that is writing this is still running, so its words may reveal. */
      isLiveTurnMessage: boolean;
      /** Tools are running underneath it, so it keeps the sheen until they land. */
      isLiveThought: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "subagents-started";
      id: string;
      createdAt: string;
      agents: ReadonlyArray<SubagentSummary>;
    }
  | {
      kind: "subagent-finished";
      id: string;
      createdAt: string;
      agent: SubagentSummary;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && !message.streaming) {
      lastBoundary = message.updatedAt;
    }
  }

  return result;
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

interface TurnFold {
  turnId: TurnId;
  anchorEntryId: string;
  createdAt: string;
  hiddenEntryIds: ReadonlySet<string>;
  /** The head's text without its duration, so the timer keeps its own column. */
  label: string;
  duration: string | null;
  /** One word for how the turn ended, when it did not simply finish. */
  status: string | null;
}

/** The anchor a running turn's head sits at, and what the head should say. */
interface LiveTurnHead {
  turnId: TurnId | null;
  anchorEntryId: string | null;
  label: string;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

/** What a tool call is called, in the one form every row shows it in. */
export function workEntryHeading(entry: Pick<WorkLogEntry, "label" | "toolTitle">): string {
  return capitalizePhrase(normalizeCompactToolLabel(entry.toolTitle || entry.label));
}

/**
 * What a tool call reads as on the status line while nothing more specific is
 * known about it — keyed by the runtime's item type, so a provider that sends
 * no title still gets a sentence rather than a shrug.
 */
const LIVE_WORK_ITEM_TYPE_LABELS: Readonly<Record<ToolLifecycleItemType, string>> = {
  command_execution: "Running command",
  file_change: "Editing files",
  file_read: "Reading files",
  mcp_tool_call: "Calling tool",
  dynamic_tool_call: "Calling tool",
  collab_agent_tool_call: "Delegating work",
  web_search: "Searching the web",
  image_view: "Viewing image",
};

/**
 * What the status line says while the turn's newest tool call is on the table.
 *
 * The call in flight names itself — "Read file", "Command run", "Listed
 * directory" — the same heading its settled row will carry, so the line and
 * the trace never disagree about what happened. The moment the call lands
 * (completed, failed, declined, stopped) the line falls back to "Working":
 * the beat between one call finishing and the next thing starting.
 */
function deriveLiveWorkLabel(entry: WorkLogEntry): string {
  const status = entry.toolLifecycleStatus;
  if (status !== undefined && status !== "inProgress") {
    return "Working";
  }
  const heading = workEntryHeading(entry);
  if (heading.length > 0) {
    return heading;
  }
  if (entry.itemType !== undefined) {
    return LIVE_WORK_ITEM_TYPE_LABELS[entry.itemType];
  }
  return "Working";
}

/**
 * The state a running turn is in, read off the newest thing the turn has
 * produced.
 *
 * The one status line the running turn has: tool calls swap through it by
 * name (see `deriveLiveWorkLabel`) instead of standing in their own row above
 * it — one line that shuffles "Read file" → "Working" → "Command run", the
 * way Codex reads. Text arriving is "Writing", a plan on the table is
 * "Planning", anything else is "Thinking".
 */
function deriveLiveTurnLabel(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  turnId: TurnId | null,
): string {
  if (turnId === null) {
    return "Thinking";
  }
  for (let index = timelineEntries.length - 1; index >= 0; index -= 1) {
    const entry = timelineEntries[index];
    if (!entry) continue;
    if (entry.kind === "work") {
      if (entry.entry.turnId !== turnId) continue;
      return deriveLiveWorkLabel(entry.entry);
    }
    if (entry.kind === "message") {
      if (entry.message.role !== "assistant" || entry.message.turnId !== turnId) continue;
      return entry.message.streaming ? "Writing" : "Thinking";
    }
    if (entry.kind === "proposed-plan") {
      return "Planning";
    }
  }
  return "Thinking";
}

/**
 * The session's running turn is authoritative when latestTurn briefly lags or
 * regresses behind it. Otherwise, the latest turn counts as unsettled while it
 * is still running (or has not recorded a completion). This is deliberately
 * keyed on turn lifecycle rather than transient working state: right after the
 * user sends a message, the previous turn is still the "active" one until the
 * server creates the new turn, and folding must not flicker through that window.
 */
function deriveUnsettledTurnId(
  latestTurn: TimelineLatestTurn | null,
  runningTurnId: TurnId | null,
): TurnId | null {
  if (runningTurnId !== null) {
    return runningTurnId;
  }
  if (!latestTurn) {
    return null;
  }
  const isSettled = latestTurn.completedAt !== null && latestTurn.state !== "running";
  return isSettled ? null : latestTurn.turnId;
}

/**
 * Everything between one user message and the next folds behind a single
 * "Worked for ..." row, anchored at the exchange's first entry; only the last
 * terminal assistant message stays visible below it. The running exchange
 * reports where its head belongs instead — the same anchor, so the line the
 * user has been watching does not move when the work ends.
 *
 * The unit is the user's message, not the server's turn: a background
 * continuation (a task notification, a wakeup) starts a new turn without a new
 * user message, and folding per turn stacked a second "Worked for" under the
 * first for what the reader experiences as one answer.
 */
function deriveTurnFolds(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  terminalAssistantMessageIds: ReadonlySet<string>;
  latestTurn: TimelineLatestTurn | null;
  unsettledTurnId: TurnId | null;
  liveTurnAnchor: { entryId: string | null; startBoundary: string | null };
}): ReadonlyMap<string, TurnFold> {
  interface ExchangeRegion {
    entries: Array<TimelineEntry>;
    turnIds: Set<TurnId>;
    /** The newest turn of the exchange — the id the fold row is keyed by, so
     * the live head (keyed by the running turn) settles into the same row. */
    lastTurnId: TurnId | null;
    hasStreamingMessage: boolean;
    /**
     * The user message that kicked the exchange off. Entry timestamps alone
     * undercount the duration (the first entry appears only once the
     * provider starts producing output), and a turn cut short by a steer may
     * hold a single instantaneous commentary message.
     */
    startBoundary: string | null;
  }

  const regions: ExchangeRegion[] = [];
  let pendingUserBoundary: string | null = null;
  let current: ExchangeRegion | null = null;
  for (const entry of input.timelineEntries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      pendingUserBoundary = entry.message.createdAt;
      current = null;
      continue;
    }
    const turnId =
      entry.kind === "message" && entry.message.role === "assistant"
        ? (entry.message.turnId ?? null)
        : entry.kind === "work"
          ? (entry.entry.turnId ?? null)
          : null;
    if (!turnId) {
      continue;
    }
    if (!current) {
      current = {
        entries: [],
        turnIds: new Set(),
        lastTurnId: null,
        hasStreamingMessage: false,
        startBoundary: pendingUserBoundary,
      };
      pendingUserBoundary = null;
      regions.push(current);
    }
    current.entries.push(entry);
    current.turnIds.add(turnId);
    current.lastTurnId = turnId;
    if (entry.kind === "message" && entry.message.streaming) {
      current.hasStreamingMessage = true;
    }
  }

  const foldsByAnchorEntryId = new Map<string, TurnFold>();
  for (const region of regions) {
    const firstEntry = region.entries[0];
    const lastEntry = region.entries.at(-1);
    if (!firstEntry || !lastEntry || region.lastTurnId === null) {
      continue;
    }
    if (input.unsettledTurnId !== null && region.turnIds.has(input.unsettledTurnId)) {
      // The whole exchange is the live head's, earlier sibling turns included.
      input.liveTurnAnchor.entryId = firstEntry.id;
      input.liveTurnAnchor.startBoundary = region.startBoundary;
      continue;
    }
    if (region.hasStreamingMessage) {
      continue;
    }

    /* The last terminal message of the exchange is the answer that stays. */
    let terminalEntry: Extract<TimelineEntry, { kind: "message" }> | null = null;
    for (let index = region.entries.length - 1; index >= 0; index -= 1) {
      const entry = region.entries[index];
      if (entry?.kind === "message" && input.terminalAssistantMessageIds.has(entry.message.id)) {
        terminalEntry = entry;
        break;
      }
    }

    const hiddenEntryIds = new Set<string>();
    for (const entry of region.entries) {
      if (entry.id !== terminalEntry?.id) {
        hiddenEntryIds.add(entry.id);
      }
    }
    /* An empty set is not a reason to skip: a text-only exchange still gets
       its "Worked for" line — it just has nothing to fold, which the head row
       carries as `collapsible: false`. Skipping here was why a plain answer
       showed no status line at all. */

    const isLatestInterrupted =
      input.latestTurn?.state === "interrupted" && region.turnIds.has(input.latestTurn.turnId);
    /*
     * The exchange ends with its newest turn, so when that turn is the session's
     * latest its recorded timings beat the entry timestamps: a turn cut short by
     * a steer may hold one instantaneous commentary message, and trailing work
     * entries can land behind the terminal message — take whichever ended last.
     */
    const latestTurnInRegion =
      input.latestTurn !== null && region.turnIds.has(input.latestTurn.turnId)
        ? input.latestTurn
        : null;
    const lastEntryEnd =
      lastEntry.kind === "message" ? lastEntry.message.updatedAt : lastEntry.createdAt;
    const entryEnd =
      maxIsoTimestamp(terminalEntry?.message.updatedAt ?? null, lastEntryEnd) ?? lastEntryEnd;
    const start = region.startBoundary ?? latestTurnInRegion?.startedAt ?? firstEntry.createdAt;
    const end = latestTurnInRegion
      ? (maxIsoTimestamp(latestTurnInRegion.completedAt, entryEnd) ?? entryEnd)
      : entryEnd;
    const elapsedMs = computeElapsedMs(start, end);
    const duration = elapsedMs !== null ? formatDuration(elapsedMs) : null;
    /*
     * The duration travels beside the label rather than inside it, so the head
     * can keep it in the same tabular column its live timer counted in — the
     * timer stopping is then the only thing that changes about that column.
     */
    /*
     * The frame reads the same however the turn ended: it says how long the
     * work took, and one quiet word beside it says if it did not simply
     * finish. A sentence that rewrote itself per outcome ("You stopped this
     * response") made the end of a turn shout.
     */
    const label = duration ? "Worked for" : "Worked";

    foldsByAnchorEntryId.set(firstEntry.id, {
      turnId: region.lastTurnId,
      anchorEntryId: firstEntry.id,
      createdAt: firstEntry.createdAt,
      hiddenEntryIds,
      label,
      duration,
      status: isLatestInterrupted ? "interrupted" : null,
    });
  }
  return foldsByAnchorEntryId;
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn?: TimelineLatestTurn | null;
  runningTurnId?: TurnId | null;
  expandedTurnIds?: ReadonlySet<TurnId>;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
  /** What the thread last failed with, if anything. Hung on the turn it ended. */
  threadError?: string | null | undefined;
  subagents?: ReadonlyArray<SubagentSummary>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);
  const unsettledTurnId = deriveUnsettledTurnId(
    input.latestTurn ?? null,
    input.runningTurnId ?? null,
  );
  const liveTurnAnchor: { entryId: string | null; startBoundary: string | null } = {
    entryId: null,
    startBoundary: null,
  };
  const foldsByAnchorEntryId = deriveTurnFolds({
    timelineEntries: input.timelineEntries,
    terminalAssistantMessageIds,
    latestTurn: input.latestTurn ?? null,
    unsettledTurnId,
    liveTurnAnchor,
  });
  const collapsedEntryIds = new Set<string>();
  for (const fold of foldsByAnchorEntryId.values()) {
    if (!input.expandedTurnIds?.has(fold.turnId)) {
      for (const entryId of fold.hiddenEntryIds) {
        collapsedEntryIds.add(entryId);
      }
    }
  }
  /*
   * A turn is live while the timeline still holds it unsettled — the same
   * lifecycle the folding above is keyed on, and for the same reason. The
   * session's status is a fact about the connection: it lags, and it flickers
   * through a reconnect or a re-hydrated snapshot. Keying the status line on it
   * is what let the line disappear from under a turn that was plainly still
   * working. `isWorking` still opens the window before the server has created
   * the turn, which is the one thing the lifecycle cannot know yet.
   */
  const liveHead: LiveTurnHead | null =
    input.isWorking || unsettledTurnId !== null
      ? {
          turnId: unsettledTurnId,
          anchorEntryId: liveTurnAnchor.entryId,
          label: deriveLiveTurnLabel(input.timelineEntries, unsettledTurnId),
        }
      : null;
  const buildLiveHeadRow = (createdAt: string | null): MessagesTimelineRow => ({
    kind: "turn-head",
    // Keyed by the turn so the row survives the turn ending: the head is the one
    // thing in a turn that has to stay put while everything under it collapses.
    // Before the server has created the turn there is no id to key it by, and one
    // shared id is right — there is only ever one turn running.
    id: liveHead?.turnId == null ? "turn-head:live" : `turn-head:${String(liveHead.turnId)}`,
    createdAt,
    turnId: liveHead?.turnId ?? null,
    state: "live",
    label: "Working for",
    duration: null,
    /* From the user's message when known — the settled "Worked for" measures
       from the same instant, so the number never jumps at settle. */
    startedAt: liveTurnAnchor.startBoundary ?? input.activeTurnStartedAt,
    expanded: true,
    collapsible: false,
    status: null,
    statusDetail: null,
  });

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    const turnFold = foldsByAnchorEntryId.get(timelineEntry.id);
    if (turnFold) {
      nextRows.push({
        kind: "turn-head",
        id: `turn-head:${turnFold.turnId}`,
        createdAt: turnFold.createdAt,
        turnId: turnFold.turnId,
        state: "done",
        label: turnFold.label,
        duration: turnFold.duration,
        startedAt: null,
        expanded: input.expandedTurnIds?.has(turnFold.turnId) ?? false,
        collapsible: turnFold.hiddenEntryIds.size > 0,
        status: turnFold.status,
        statusDetail: null,
      });
    }

    if (liveHead && liveHead.anchorEntryId === timelineEntry.id) {
      nextRows.push(buildLiveHeadRow(timelineEntry.createdAt));
    }

    if (collapsedEntryIds.has(timelineEntry.id)) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (
          !nextEntry ||
          nextEntry.kind !== "work" ||
          collapsedEntryIds.has(nextEntry.id) ||
          foldsByAnchorEntryId.has(nextEntry.id)
        ) {
          break;
        }
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
        live: false,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      unsettledTurnId !== null &&
      timelineEntry.message.turnId === unsettledTurnId;

    const durationStart =
      durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt;

    // While the turn is still running, the latest assistant message is only
    // provisionally terminal — withhold the metadata row until the turn
    // settles so commentary doesn't flash timestamps mid-work.
    const showAssistantMeta =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id) &&
      !assistantTurnStillInProgress;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart,
      showAssistantMeta,
      showAssistantCopyButton: showAssistantMeta,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      // A provider that leaves turnId unset still streams; the text arriving is
      // liveness enough to reveal it word by word.
      isLiveTurnMessage:
        timelineEntry.message.role === "assistant" &&
        (assistantTurnStillInProgress || timelineEntry.message.streaming),
      isLiveThought: false,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (liveHead && liveHead.anchorEntryId === null) {
    // A turn that has produced nothing yet: the head is the whole turn, and it
    // belongs where its first entry is about to appear.
    nextRows.push(buildLiveHeadRow(input.activeTurnStartedAt));
  }

  attachThreadError(nextRows, input.threadError ?? null);
  const settled = settleWorkRows(markLiveTail(nextRows, liveHead !== null));
  if (liveHead === null) {
    return insertSubagentRows(settled, input.subagents ?? []);
  }
  /*
   * The live work group does not render as a row of its own: the status line
   * below carries the call it is on by name (see `deriveLiveWorkLabel`), and
   * two lines describing the same call — one stacked above the other — is
   * exactly what made a running turn read as a log. The group's entries are
   * still in the timeline; they surface as one settled row the moment the
   * group stops being the tail (next thought, or turn end).
   */
  const liveWorkRows = settled.filter(
    (row): row is Extract<MessagesTimelineRow, { kind: "work" }> =>
      row.kind === "work" &&
      (liveHead.turnId === null
        ? row.live
        : row.groupedEntries.some((entry) => entry.turnId === liveHead.turnId)),
  );
  const liveWorkRowIds = new Set(liveWorkRows.map((row) => row.id));
  const liveGroupedEntries = liveWorkRows.flatMap((row) => row.groupedEntries);
  // While a turn runs, its one tail owns the whole call list. Commentary may
  // arrive between calls without collapsing or resetting that list. Once the
  // final answer lands the ordinary historical work rows return.
  const visible = settled.filter((row) => !liveWorkRowIds.has(row.id));
  /*
   * The animated reading of the turn, at its bottom. One constant id: exactly
   * one exists at a time, and a constant id is what stops it remounting when
   * the server assigns the turn its real id mid-flight.
   */
  return [
    ...insertSubagentRows(visible, input.subagents ?? []),
    {
      kind: "turn-tail",
      id: "turn-tail:live",
      createdAt: input.activeTurnStartedAt,
      label: liveHead.label,
      groupedEntries: liveGroupedEntries,
    },
  ];
}

function insertSubagentRows(
  rows: ReadonlyArray<MessagesTimelineRow>,
  subagents: ReadonlyArray<SubagentSummary>,
): MessagesTimelineRow[] {
  type SubagentRow = Extract<
    MessagesTimelineRow,
    { kind: "subagents-started" | "subagent-finished" }
  >;
  const spawnGroups = new Map<string, SubagentSummary[]>();
  for (const agent of subagents) {
    const key = agent.agent.parentToolUseId ?? agent.startedAt;
    const group = spawnGroups.get(key);
    if (group) group.push(agent);
    else spawnGroups.set(key, [agent]);
  }
  const agentRows: SubagentRow[] = [];
  for (const [groupId, agents] of spawnGroups) {
    const first = agents[0];
    if (!first) continue;
    agentRows.push({
      kind: "subagents-started",
      id: `subagents-started:${groupId}`,
      createdAt: agents.reduce(
        (earliest, agent) =>
          agent.startedAt.localeCompare(earliest) < 0 ? agent.startedAt : earliest,
        first.startedAt,
      ),
      agents,
    });
  }
  for (const agent of subagents) {
    if (!agent.finishedAt) continue;
    agentRows.push({
      kind: "subagent-finished",
      id: `subagent-finished:${agent.agent.agentId}`,
      createdAt: agent.finishedAt,
      agent,
    });
  }
  if (agentRows.length === 0) return [...rows];
  const pending = agentRows.toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const merged: MessagesTimelineRow[] = [];
  let eventIndex = 0;
  for (const row of rows) {
    while (pending[eventIndex] && pending[eventIndex]!.createdAt < (row.createdAt ?? "")) {
      merged.push(pending[eventIndex]!);
      eventIndex += 1;
    }
    merged.push(row);
  }
  merged.push(...pending.slice(eventIndex));
  return merged;
}

/**
 * A call that produced nothing is not worth a line in a finished trace — but it
 * is worth one while it is the call being made.
 *
 * Which is why this runs after the tail is marked: a tool call is "neither
 * succeeded nor failed" for as long as it is in progress, so filtering before
 * knowing which group is live would hide exactly the call the status line is
 * naming. A group left with nothing at all goes.
 */
/**
 * Hangs what the thread last failed with on the turn it ended.
 *
 * The newest head is that turn: an error belongs to the exchange the reader is
 * looking at, and saying so there is what replaced the banner that used to
 * stand between the header and the conversation. The word goes on the line, the
 * text goes behind it — a head with something to say is openable even when it
 * has no work folded under it.
 */
function attachThreadError(rows: MessagesTimelineRow[], error: string | null): void {
  if (error === null) return;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined || row.kind !== "turn-head") continue;
    rows[index] = {
      ...row,
      status: row.status ?? "failed",
      statusDetail: error,
      collapsible: true,
    };
    return;
  }
}

function settleWorkRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const settled: MessagesTimelineRow[] = [];
  for (const row of rows) {
    if (row.kind !== "work" || row.live) {
      settled.push(row);
      continue;
    }
    const entries = row.groupedEntries.filter(
      (entry) => !workEntryIndicatesToolNeutralStatus(entry),
    );
    if (entries.length === 0) {
      continue;
    }
    settled.push(
      entries.length === row.groupedEntries.length ? row : { ...row, groupedEntries: entries },
    );
  }
  return settled;
}

/**
 * What the bottom of a running turn is doing right now.
 *
 * The tool group at the tail is the one making calls, and a piece of commentary
 * directly above it is the thought those calls belong to — so it keeps its sheen
 * until they land. Both are read off the row order rather than tracked, because
 * the order is the only thing that ties a thought to the work it started.
 */
function markLiveTail(rows: MessagesTimelineRow[], turnIsRunning: boolean): MessagesTimelineRow[] {
  if (!turnIsRunning) {
    return rows;
  }
  const tailIndex = rows.length - 1;
  const tail = rows[tailIndex];
  if (tail?.kind !== "work") {
    return rows;
  }
  rows[tailIndex] = { ...tail, live: true };

  const above = rows[tailIndex - 1];
  if (above?.kind === "message" && above.message.role === "assistant") {
    rows[tailIndex - 1] = { ...above, isLiveThought: true };
  }
  return rows;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "turn-head": {
      const bh = b as typeof a;
      return (
        a.createdAt === bh.createdAt &&
        a.state === bh.state &&
        a.label === bh.label &&
        a.duration === bh.duration &&
        a.startedAt === bh.startedAt &&
        a.expanded === bh.expanded &&
        a.collapsible === bh.collapsible &&
        a.status === bh.status &&
        a.statusDetail === bh.statusDetail
      );
    }

    case "turn-tail": {
      const bt = b as typeof a;
      return (
        a.createdAt === bt.createdAt &&
        a.label === bt.label &&
        Equal.equals(a.groupedEntries, bt.groupedEntries)
      );
    }

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "subagents-started":
      return Equal.equals(a.agents, (b as typeof a).agents);

    case "subagent-finished":
      return Equal.equals(a.agent, (b as typeof a).agent);

    case "work": {
      const bw = b as typeof a;
      return a.live === bw.live && Equal.equals(a.groupedEntries, bw.groupedEntries);
    }

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.isLiveTurnMessage === bm.isLiveTurnMessage &&
        a.isLiveThought === bm.isLiveThought &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
