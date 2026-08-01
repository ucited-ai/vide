/**
 * Every choice the chat's motion and layout offer, in one place.
 *
 * The ids live in the settings contract because they are persisted; everything
 * a human sees or a component does with them lives here. A variant is therefore
 * two edits — an id in `@vide/contracts/settings` and a row in the matching
 * table below — and the tables are keyed by the contract union, so leaving the
 * second one out is a type error naming this file rather than a silent gap in
 * the picker.
 *
 * The motion itself is CSS: the label tables carry no timings, because a
 * variant's feel belongs next to the other type in `vide-theme.css`, not in a
 * TypeScript object the stylesheet cannot see.
 */
import {
  ChatChangedFilesLayout,
  ChatStreamAnimation,
  ChatThinkingIndicator,
  DEFAULT_CHAT_CHANGED_FILES_LAYOUT,
  DEFAULT_CHAT_STREAM_ANIMATION,
  DEFAULT_CHAT_THINKING_INDICATOR,
} from "@vide/contracts/settings";

import { useMemo } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import {
  THINKING_INDICATOR_PAINTERS,
  type ThinkingIndicatorPainter,
} from "./thinkingIndicatorPainters";

export interface ChatAppearanceOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** Contract order in, picker order out — the list reads the same in both places. */
function toOptions<Id extends string>(
  ids: ReadonlyArray<Id>,
  labels: Readonly<Record<Id, string>>,
): ReadonlyArray<ChatAppearanceOption<Id>> {
  return ids.map((id) => ({ id, label: labels[id] }));
}

/**
 * Settings persisted by an older build can name a variant this one no longer
 * has. Nothing about that is worth an error dialog: the axis falls back to its
 * default and the rest of the user's settings stand.
 */
function resolveOption<Id extends string>(
  labels: Readonly<Record<Id, string>>,
  fallback: Id,
  value: string,
): Id {
  return value in labels ? (value as Id) : fallback;
}

// ── streamed prose ──────────────────────────────────────────────────

const STREAM_ANIMATION_LABELS: Readonly<Record<ChatStreamAnimation, string>> = {
  instant: "Instant",
  assemble: "Assemble",
  fade: "Fade",
  blur: "Blur",
  wipe: "Wipe",
  sweep: "Sweep",
  phrase: "Phrase",
};

export const CHAT_STREAM_ANIMATIONS = toOptions(
  ChatStreamAnimation.literals,
  STREAM_ANIMATION_LABELS,
);

export function resolveChatStreamAnimation(value: string): ChatStreamAnimation {
  return resolveOption(STREAM_ANIMATION_LABELS, DEFAULT_CHAT_STREAM_ANIMATION, value);
}

// ── the live indicator ──────────────────────────────────────────────

const THINKING_INDICATOR_LABELS: Readonly<Record<ChatThinkingIndicator, string>> = {
  orbits: "Orbits",
  scan: "Scan",
  mark: "Mark",
  sonar: "Sonar",
  swarm: "Swarm",
  helix: "Helix",
};

export const CHAT_THINKING_INDICATORS = toOptions(
  ChatThinkingIndicator.literals,
  THINKING_INDICATOR_LABELS,
);

export function resolveChatThinkingIndicator(value: string): ChatThinkingIndicator {
  return resolveOption(THINKING_INDICATOR_LABELS, DEFAULT_CHAT_THINKING_INDICATOR, value);
}

export function chatThinkingIndicatorPainter(value: string): ThinkingIndicatorPainter {
  return THINKING_INDICATOR_PAINTERS[resolveChatThinkingIndicator(value)];
}

// ── the files a turn changed ────────────────────────────────────────

const CHANGED_FILES_LAYOUT_LABELS: Readonly<Record<ChatChangedFilesLayout, string>> = {
  tree: "Tree",
  rows: "Rows",
  stat: "Stat",
  cards: "Cards",
  split: "Split",
  strip: "Strip",
};

export const CHAT_CHANGED_FILES_LAYOUTS = toOptions(
  ChatChangedFilesLayout.literals,
  CHANGED_FILES_LAYOUT_LABELS,
);

export function resolveChatChangedFilesLayout(value: string): ChatChangedFilesLayout {
  return resolveOption(CHANGED_FILES_LAYOUT_LABELS, DEFAULT_CHAT_CHANGED_FILES_LAYOUT, value);
}

// ── what the transcript reads ───────────────────────────────────────

export interface ChatAppearanceSettings {
  readonly streamAnimation: ChatStreamAnimation;
  readonly thinkingIndicator: ChatThinkingIndicator;
  readonly changedFilesLayout: ChatChangedFilesLayout;
}

/**
 * All three axes, resolved once.
 *
 * The transcript subscribes here rather than in each row, so a settings change
 * is one re-render of the list owner instead of one per message on screen.
 */
export function useChatAppearance(): ChatAppearanceSettings {
  const settings = useClientSettings();
  const { chatChangedFilesLayout, chatStreamAnimation, chatThinkingIndicator } = settings;

  return useMemo(
    () => ({
      streamAnimation: resolveChatStreamAnimation(chatStreamAnimation),
      thinkingIndicator: resolveChatThinkingIndicator(chatThinkingIndicator),
      changedFilesLayout: resolveChatChangedFilesLayout(chatChangedFilesLayout),
    }),
    [chatChangedFilesLayout, chatStreamAnimation, chatThinkingIndicator],
  );
}
