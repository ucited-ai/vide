import {
  type EnvironmentId,
  type MessageId,
  type ScopedThreadRef,
  type ServerProviderSkill,
  type TurnId,
} from "@vide/contracts";
import { type TimestampFormat } from "@vide/contracts/settings";
import { createContext } from "react";

import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { type ChatAppearanceSettings } from "./chatAppearance";

/**
 * Shared state consumed by every timeline row.
 *
 * Propagates through LegendList's memo boundaries, which is why it is a context
 * rather than props: a callback threaded down as a prop re-renders every row on
 * the list owner's next commit, and a virtualized list is a list of memo
 * boundaries. `nowIso` is deliberately absent — the rows that tick (the turn
 * head's timer) own their own clock.
 *
 * It lives in its own module so a row component can read it without importing
 * the list that renders it.
 */
export interface TimelineRowSharedState {
  timestampFormat: TimestampFormat;
  chatAppearance: ChatAppearanceSettings;
  routeThreadKey: string;
  threadRef: ScopedThreadRef | null;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertUserMessage: (messageId: MessageId) => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onToggleTurnFold: (turnId: TurnId) => void;
  onOpenSubagent: (agentId: string) => void;
  /**
   * Open/closed state of work groups and their calls, by row/entry id. A row's
   * own useState dies when the row leaves the virtualizer's buffer, and an
   * expanded group snapping shut because the reader scrolled away and back is
   * state loss, not a choice anyone made. Mutable and read at mount on
   * purpose: writes must not re-render the list.
   */
  workRowOpenById: Map<string, boolean>;
}

export interface TimelineRowActivityState {
  isWorking: boolean;
  isRevertingCheckpoint: boolean;
  activeTurnInProgress: boolean;
  latestTurnId: TurnId | null;
}

export interface TimelineRevealState {
  settlesAtByMessageId: ReadonlyMap<string, number>;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);
export const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);
export const TimelineRevealCtx = createContext<TimelineRevealState>(null!);
export const TimelineRevealReportCtx = createContext<
  (messageId: string, settlesAtMs: number | null) => void
>(null!);
