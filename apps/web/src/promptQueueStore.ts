import { create } from "zustand";

import { type ComposerImageAttachment } from "./composerDraftStore";

/**
 * Prompts written while a turn is still running, waiting for it to finish.
 *
 * The honest half of mid-turn input. Steering (⌘⏎) feeds the running turn and
 * may rightfully show a sent bubble at once; everything else waits here — in
 * plain sight above the composer, editable and removable — and only becomes a
 * message the moment it is actually dispatched as the next turn. A bubble
 * appearing instantly for a prompt no model has read yet is the lie this store
 * exists to remove.
 *
 * Session-scoped on purpose: a queued prompt is a decision about *this* run's
 * follow-up, not a draft worth persisting. Durable stashing is the prompt
 * stash's job (⌘S).
 */
export interface QueuedPromptEntry {
  readonly id: string;
  /** Full text as the send would carry it — contexts already appended. */
  readonly prompt: string;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly queuedAt: string;
}

interface PromptQueueState {
  readonly queuesByThreadKey: Record<string, ReadonlyArray<QueuedPromptEntry>>;
  /**
   * Entry id whose automatic dispatch failed, per thread. While the head of a
   * queue matches its hold, the auto-dispatcher leaves it alone — otherwise a
   * send that fails while the thread is idle would retry in a hot loop. Any
   * user action on the queue clears the hold.
   */
  readonly dispatchHoldByThreadKey: Record<string, string>;
  readonly enqueue: (threadKey: string, entry: QueuedPromptEntry) => void;
  /** Put a taken entry back at the front and hold it out of auto-dispatch. */
  readonly requeueFront: (threadKey: string, entry: QueuedPromptEntry) => void;
  readonly takeFirst: (threadKey: string) => QueuedPromptEntry | null;
  readonly removeEntry: (threadKey: string, entryId: string) => QueuedPromptEntry | null;
}

const EMPTY_QUEUE: ReadonlyArray<QueuedPromptEntry> = [];

export const usePromptQueueStore = create<PromptQueueState>((set, get) => ({
  queuesByThreadKey: {},
  dispatchHoldByThreadKey: {},
  enqueue: (threadKey, entry) => {
    set((state) => {
      const { [threadKey]: _hold, ...restHolds } = state.dispatchHoldByThreadKey;
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: [...(state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE), entry],
        },
        dispatchHoldByThreadKey: restHolds,
      };
    });
  },
  requeueFront: (threadKey, entry) => {
    set((state) => ({
      queuesByThreadKey: {
        ...state.queuesByThreadKey,
        [threadKey]: [entry, ...(state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE)],
      },
      dispatchHoldByThreadKey: { ...state.dispatchHoldByThreadKey, [threadKey]: entry.id },
    }));
  },
  takeFirst: (threadKey) => {
    const queue = get().queuesByThreadKey[threadKey] ?? EMPTY_QUEUE;
    const first = queue[0];
    if (!first) return null;
    set((state) => ({
      queuesByThreadKey: {
        ...state.queuesByThreadKey,
        [threadKey]: (state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE).slice(1),
      },
    }));
    return first;
  },
  removeEntry: (threadKey, entryId) => {
    const queue = get().queuesByThreadKey[threadKey] ?? EMPTY_QUEUE;
    const entry = queue.find((candidate) => candidate.id === entryId) ?? null;
    if (!entry) return null;
    set((state) => {
      const { [threadKey]: _hold, ...restHolds } = state.dispatchHoldByThreadKey;
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: (state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE).filter(
            (candidate) => candidate.id !== entryId,
          ),
        },
        dispatchHoldByThreadKey: restHolds,
      };
    });
    return entry;
  },
}));

export function selectThreadQueue(
  state: PromptQueueState,
  threadKey: string | null,
): ReadonlyArray<QueuedPromptEntry> {
  if (threadKey === null) return EMPTY_QUEUE;
  return state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE;
}
