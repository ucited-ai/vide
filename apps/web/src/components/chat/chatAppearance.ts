/**
 * Every choice the chat's motion and layout offer, in one place.
 *
 * The ids live in the settings contract because they are persisted; everything
 * a human sees or a component does with them lives here, in a table keyed by
 * that union — so leaving a variant out of a table is a type error naming this
 * file rather than a silent gap in the picker. The picker itself is filled from
 * these tables, so a new variant never touches the settings panel.
 *
 * What a variant costs to add:
 *
 * - a changed-files layout — an id and a row here, and nothing else;
 * - a thinking indicator — an id, a row here, and a painter in
 *   `thinkingIndicatorPainters.ts` (whose table is keyed by the same union);
 * - a streaming animation — an id, a row here, and a rule plus keyframes in
 *   `vide-theme.css`. CSS is the one part no type can reach, which is why
 *   `chatAppearance.test.ts` reads the stylesheet and fails on a variant that
 *   would otherwise appear in the picker and do nothing.
 */
import {
  ChatChangedFilesLayout,
  ChatStreamAnimation,
  ChatThinkingIndicator,
} from "@vide/contracts/settings";
import { useMemo } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  THINKING_INDICATOR_PAINTERS,
  type ThinkingIndicatorPainter,
} from "./thinkingIndicatorPainters";

export interface ChatAppearanceOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** Contract order in, picker order out — the list reads the same in both places. */
function toOptions<Id extends string, Entry extends { readonly label: string }>(
  ids: ReadonlyArray<Id>,
  entries: Readonly<Record<Id, Entry>>,
): ReadonlyArray<Entry & ChatAppearanceOption<Id>> {
  return ids.map((id) => ({ ...entries[id], id }));
}

// ── streamed prose ──────────────────────────────────────────────────

const STREAM_ANIMATIONS: Readonly<Record<ChatStreamAnimation, { readonly label: string }>> = {
  instant: { label: "Instant" },
  assemble: { label: "Assemble" },
  fade: { label: "Fade" },
  blur: { label: "Blur" },
  wipe: { label: "Wipe" },
  sweep: { label: "Sweep" },
  phrase: { label: "Phrase" },
};

export const CHAT_STREAM_ANIMATIONS = toOptions(ChatStreamAnimation.literals, STREAM_ANIMATIONS);

// ── the live indicator ──────────────────────────────────────────────

const THINKING_INDICATORS: Readonly<Record<ChatThinkingIndicator, { readonly label: string }>> = {
  orbits: { label: "Orbits" },
  scan: { label: "Scan" },
  mark: { label: "Mark" },
  sonar: { label: "Sonar" },
  swarm: { label: "Swarm" },
  helix: { label: "Helix" },
};

export const CHAT_THINKING_INDICATORS = toOptions(
  ChatThinkingIndicator.literals,
  THINKING_INDICATORS,
);

export function chatThinkingIndicatorPainter(
  variant: ChatThinkingIndicator,
): ThinkingIndicatorPainter {
  return THINKING_INDICATOR_PAINTERS[variant];
}

// ── the files a turn changed ────────────────────────────────────────

/**
 * `tree` is the odd one out — it nests, and has its own component. The rest are
 * the same row repeated, and differ only in the classes below: how dense the
 * row is, whether it carries the add/delete weight bar, and how the rows are
 * arranged. A layout should change how a list reads, not what it says.
 */
interface ChatChangedFilesLayoutStyle {
  readonly label: string;
  /** The element the rows sit in. Empty when the rows need no arrangement. */
  readonly container: string;
  /** Each row, on top of the shared row class. */
  readonly row: string;
  /** Whether the row carries the proportional add/delete bar. */
  readonly showWeight: boolean;
}

const CHANGED_FILES_LAYOUTS: Readonly<Record<ChatChangedFilesLayout, ChatChangedFilesLayoutStyle>> =
  {
    tree: { label: "Tree", container: "", row: "", showWeight: false },
    rows: { label: "Rows", container: "space-y-px", row: "px-2 py-1", showWeight: false },
    stat: { label: "Stat", container: "space-y-px", row: "px-2 py-1", showWeight: true },
    cards: {
      label: "Cards",
      container: "space-y-1.5",
      row: "rounded-(--radius) border border-border/70 px-2 py-1.5",
      showWeight: false,
    },
    // Two columns of the same row. Wide changes stop running off the bottom of
    // the card; a narrow transcript falls back to one column rather than
    // squeezing a path into half of nothing.
    split: {
      label: "Split",
      container: "grid grid-cols-1 gap-x-3 gap-y-px sm:grid-cols-2",
      row: "px-2 py-1",
      showWeight: false,
    },
    strip: {
      label: "Strip",
      container: "",
      row: "px-2 py-0.5 text-(length:--text-caption)",
      showWeight: false,
    },
  };

export const CHAT_CHANGED_FILES_LAYOUTS = toOptions(
  ChatChangedFilesLayout.literals,
  CHANGED_FILES_LAYOUTS,
);

export function chatChangedFilesLayoutStyle(
  layout: ChatChangedFilesLayout,
): ChatChangedFilesLayoutStyle {
  return CHANGED_FILES_LAYOUTS[layout];
}

// ── what the transcript reads ───────────────────────────────────────

export interface ChatAppearanceSettings {
  readonly streamAnimation: ChatStreamAnimation;
  readonly thinkingIndicator: ChatThinkingIndicator;
  readonly changedFilesLayout: ChatChangedFilesLayout;
  /** `null` where the indicator follows the type it sits in, which is the default. */
  readonly indicatorColor: string | null;
}

/**
 * Every axis, read once.
 *
 * The transcript subscribes here rather than in each row, so a settings change
 * is one re-render of the list owner instead of one per message on screen.
 *
 * No fallback for an id this build does not know: client settings are decoded
 * against the contract before they reach any of this, in the browser
 * (`clientPersistenceStorage.ts`) and on the desktop (`ipc/methods/clientSettings.ts`)
 * alike, so an unknown variant never gets this far.
 *
 * The indicator's colour is resolved for the theme on screen here, because that
 * is the only half of the setting anything can paint with.
 */
export function useChatAppearance(): ChatAppearanceSettings {
  const { chatChangedFilesLayout, chatIndicatorColor, chatStreamAnimation, chatThinkingIndicator } =
    useClientSettings();
  const { resolvedTheme } = useTheme();
  const indicatorColor =
    resolvedTheme === "dark" ? chatIndicatorColor.dark : chatIndicatorColor.light;

  return useMemo(
    () => ({
      streamAnimation: chatStreamAnimation,
      thinkingIndicator: chatThinkingIndicator,
      changedFilesLayout: chatChangedFilesLayout,
      indicatorColor,
    }),
    [chatChangedFilesLayout, chatStreamAnimation, chatThinkingIndicator, indicatorColor],
  );
}
