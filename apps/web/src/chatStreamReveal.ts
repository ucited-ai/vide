/**
 * The clock the word reveal runs on.
 *
 * The reveal used to be the provider's arrival pattern and nothing else, which
 * meant it depended on a setting most people never turn on: with
 * `enableAssistantStreaming` off the server buffers a segment and hands over the
 * whole paragraph in one delta, so every word was new in the same frame and the
 * "streaming" animation was one flash. The turn reveals on its own clock — word
 * n waits n steps — so it reads the same either way, and real streaming just
 * makes the deltas smaller.
 *
 * One rule carries the whole thing: **a word's arrival is anchored in
 * wall-clock time, not in paint time.** The first time a word appears in the
 * rendered tree it is given an instant to arrive at, and every render after
 * that writes the delay still outstanding — `arrivesAt - now`, which CSS
 * accepts as negative. A negative delay starts an animation already advanced;
 * one whose window has closed paints at rest.
 *
 * That single property replaces the bookkeeping this file used to keep, and the
 * bugs the bookkeeping was defending against:
 *
 * - a row the virtualized list remounts mid-answer resumes its words where they
 *   were, instead of replaying them from the first sentence. A CSS animation
 *   fires on any first paint, so the old scheme — remember which words were
 *   handed a style, keep answering byte-identically — replayed everything still
 *   inside its window whenever the DOM was rebuilt. An anchored word cannot
 *   replay: the paint is not what times it;
 * - a word already on screen cannot blink out. It used to need a baseline (the
 *   rendered tree's own word count) to tell "new this delta" from "already
 *   there", because a fresh delay on an old word puts it back inside its delay
 *   phase, where `animation-fill-mode: backwards` hides it. An anchored word's
 *   delay is simply negative by then;
 * - a delta cannot open a second reveal front at the tail while the head is
 *   still sweeping the first sentence — every new word queues behind one write
 *   head by construction, so there is no backlog to carry forward by hand;
 * - only a turn that is still running reveals anything, and a delta finishes
 *   revealing even if the turn settles under it: wrapping outlives `live` until
 *   the head's own clock runs out, since the buffered case lands its text a
 *   moment before the turn completes.
 */

import { type ChatStreamAnimation } from "@vide/contracts/settings";
import { useEffect, useId, useMemo, useState } from "react";

import { countStreamWords, type ChatStreamWordTiming } from "./markdown-stream-words";

/** Between one word and the next, at a paragraph's natural pace. */
const WORD_STEP_MS = 40;

/**
 * How long one delta may take to arrive in full.
 *
 * A step per word is right for the paragraph the mock was drawn against and
 * absurd for an eight-hundred-word answer, which would spend half a minute
 * appearing. Past this length the step shrinks instead: the reveal stays a sweep
 * across the text rather than becoming a queue.
 */
const MAX_DELTA_REVEAL_MS = 2_400;

/**
 * How long a word's own motion may run once its delay is up.
 *
 * An upper bound over the variants rather than any one of them — the slowest is
 * `blur` at 820ms in `vide-theme.css`. Erring long costs nothing: it only
 * decides when a word is treated as at rest, and when wrapping may stop.
 */
const WORD_MOTION_MS = 900;

/** Words arrive in threes for `phrase`, so a group waits where a word would. */
const PHRASE_WORDS = 3;
const PHRASE_STEP_FACTOR = 2.7;

/** Deterministic per-word jitter: the same word always arrives the same way. */
function noise(index: number): number {
  const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * How far apart the words of a `wordCount`-word delta arrive — the natural step
 * until a long delta would outrun its own budget.
 *
 * `backlogMs` is reveal time earlier words have already claimed: the budget
 * covers the whole queue, so a delta arriving behind a long one compresses
 * rather than pushing the sweep past the cap.
 */
export function chatStreamStepMs(
  wordCount: number,
  animation: ChatStreamAnimation,
  backlogMs = 0,
): number {
  const groups =
    animation === "phrase" ? Math.max(1, Math.ceil(wordCount / PHRASE_WORDS)) : wordCount;
  const spans = Math.max(1, groups - 1);
  const factor = animation === "phrase" ? PHRASE_STEP_FACTOR : 1;
  return Math.min(WORD_STEP_MS, Math.max(0, MAX_DELTA_REVEAL_MS - backlogMs) / (spans * factor));
}

/**
 * How far behind the write head a word arrives, given how many words were
 * handed an instant before it.
 *
 * Never negative, so the sequence stays monotone: a word can never be given an
 * instant ahead of the word in front of it, which is what lets the head alone
 * stand in for the whole queue. The jitter therefore lives in the spacing
 * rather than on top of a computed delay.
 */
export function chatStreamAdvanceMs(
  index: number,
  assignedBefore: number,
  step: number,
  animation: ChatStreamAnimation,
): number {
  if (animation === "phrase") {
    // Three words share an instant; the group after them waits for one span.
    return assignedBefore % PHRASE_WORDS === 0 ? step * PHRASE_STEP_FACTOR : 0;
  }
  return step * (0.75 + noise(index) * 0.5);
}

/**
 * The queue words are handed their instants out of: what each index arrived
 * at, and the head everything new lines up behind.
 */
export interface ChatStreamRevealQueue {
  /** The instant the word at this tree index arrives at. Assigned once. */
  readonly arrivesAtByIndex: Map<number, number>;
  /** The latest instant handed out: the one write head new words queue behind. */
  headAtMs: number;
  /** The step the current delta is being handed out at. */
  step: number;
}

/**
 * The instant the word at `index` arrives at — assigned the first time the
 * index is seen, and never revised.
 *
 * That is the anchor the whole reveal rests on. Because the answer for an index
 * never changes, a row that remounts mid-answer hands its words the instants
 * they already had: their remaining delay is negative, so they paint where they
 * were instead of animating again. And because a new word can only be given
 * `head + advance`, a delta arriving while the previous one is still sweeping
 * queues behind it rather than opening a second front at the tail.
 */
export function chatStreamArrivesAtMs(
  queue: ChatStreamRevealQueue,
  index: number,
  animation: ChatStreamAnimation,
  nowMs: number,
): number {
  const known = queue.arrivesAtByIndex.get(index);
  if (known !== undefined) return known;
  const at = Math.max(
    nowMs,
    queue.headAtMs + chatStreamAdvanceMs(index, queue.arrivesAtByIndex.size, queue.step, animation),
  );
  queue.arrivesAtByIndex.set(index, at);
  queue.headAtMs = at;
  return at;
}

export interface ChatStreamRevealState {
  /** Whether this render should wrap words at all. */
  readonly active: boolean;
  readonly timing: ChatStreamWordTiming;
  /** The current wall-clock instant after which following UI may appear. */
  readonly settlesAtMs: () => number | null;
}

const NO_REVEAL: ChatStreamRevealState = {
  active: false,
  timing: {
    styleOf: () => null,
    blockStyleOf: () => null,
  },
  settlesAtMs: () => null,
};

/**
 * Everything the reveal remembers between renders — and between mounts.
 *
 * Keyed by the message rather than held in a ref, because the component's
 * lifetime is not the message's: the virtualized list unmounts and remounts
 * rows as their heights churn. What survives is only the anchor — when each
 * word arrives — plus the pacing of the delta being handed out. An entry is
 * dropped when its message's reveal settles, and the cap sweeps up entries
 * whose rows unmounted mid-turn and never came back.
 */
interface ChatStreamRevealMemory extends ChatStreamRevealQueue {
  /** The text last rendered, so a delta is recognised without re-counting it. */
  text: string;
  /** Source-token count of that text — pacing only, never a baseline. */
  sourceWordCount: number;
}

const REVEAL_MEMORY_CAP = 64;
const revealMemoryByKey = new Map<string, ChatStreamRevealMemory>();

function acquireRevealMemory(key: string): ChatStreamRevealMemory {
  const existing = revealMemoryByKey.get(key);
  if (existing) {
    /* Re-insert on hit, so the cap below evicts the least recently *touched*
       entry. Insertion order alone would make the longest-lived entry — the
       message that is still streaming — the first to go. */
    revealMemoryByKey.delete(key);
    revealMemoryByKey.set(key, existing);
    return existing;
  }
  const fresh: ChatStreamRevealMemory = {
    arrivesAtByIndex: new Map(),
    headAtMs: 0,
    text: "",
    sourceWordCount: 0,
    step: WORD_STEP_MS,
  };
  revealMemoryByKey.set(key, fresh);
  if (revealMemoryByKey.size > REVEAL_MEMORY_CAP) {
    const oldest = revealMemoryByKey.keys().next().value;
    if (oldest !== undefined) revealMemoryByKey.delete(oldest);
  }
  return fresh;
}

export function useChatStreamReveal(input: {
  readonly text: string;
  readonly animation: ChatStreamAnimation | undefined;
  /** Whether the turn this text belongs to is still running. */
  readonly live: boolean;
  /**
   * Stable identity of the text across remounts — the message id. Without it
   * the reveal falls back to this component instance, which is only safe for
   * hosts that never recycle their rows.
   */
  readonly memoryKey?: string | undefined;
}): ChatStreamRevealState {
  const animation = input.animation;
  const reveals = input.live && animation !== undefined && animation !== "instant";

  const instanceKey = useId();
  const memoryKey = input.memoryKey ?? instanceKey;
  const [settling, setSettling] = useState(false);

  /* Acquired only while the reveal is live or finishing. Settled anchors stay
     in the capped registry, but settled renders do not touch their LRU order. */
  const memory = reveals || settling ? acquireRevealMemory(memoryKey) : null;

  /*
   * Pace the delta during render, before its words ask for their instants: how
   * fast to hand them out is a property of how much text arrived at once and of
   * how much is still queued ahead of it.
   */
  if (memory !== null && reveals && memory.text !== input.text) {
    const sourceWordCount = countStreamWords(input.text);
    const deltaWordCount = Math.max(1, sourceWordCount - memory.sourceWordCount);
    const backlogMs = Math.max(0, memory.headAtMs - Date.now());
    memory.step = chatStreamStepMs(deltaWordCount, animation, backlogMs);
    memory.text = input.text;
    memory.sourceWordCount = sourceWordCount;
  }

  /*
   * Wrapping outlives `live` until the head's clock runs out, so the last thing
   * a turn writes still arrives word by word after the turn is marked complete.
   */
  const settlesInMs =
    memory === null ? 0 : Math.max(0, memory.headAtMs - Date.now()) + WORD_MOTION_MS;
  useEffect(() => {
    if (reveals) {
      setSettling(true);
      return;
    }
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), settlesInMs);
    return () => clearTimeout(timer);
  }, [reveals, settlesInMs, settling]);

  const active = (reveals || settling) && animation !== undefined && animation !== "instant";

  /* Keep settled anchors in the bounded LRU. A provider snapshot can briefly
     mark the same message inactive and live again while a turn changes phase;
     deleting its anchor in that gap restarts every word from zero. The cap
     still bounds the registry, while a re-acquired message resumes at rest. */

  return useMemo(() => {
    if (!active || animation === undefined || memory === null) return NO_REVEAL;

    /**
     * What is left of a word's wait. Null once its motion is over: the tree at
     * rest is plain markup again, which is also what keeps the churn bounded —
     * only the words inside the reveal window carry a style that changes from
     * render to render, and that window is a couple of seconds wide however
     * long the answer is.
     */
    const delayStyleOf = (index: number): string | null => {
      const nowMs = Date.now();
      const delayMs = Math.round(chatStreamArrivesAtMs(memory, index, animation, nowMs) - nowMs);
      return delayMs <= -WORD_MOTION_MS ? null : `--chat-stream-delay:${String(delayMs)}ms`;
    };

    return {
      active: true,
      settlesAtMs: () => memory.headAtMs + WORD_MOTION_MS,
      timing: {
        styleOf: (index: number): string | null => {
          const delay = delayStyleOf(index);
          if (delay === null) return null;
          const angle = noise(index) * Math.PI * 2;
          return [
            delay,
            `--chat-stream-dx:${(Math.cos(angle) * 8).toFixed(1)}px`,
            `--chat-stream-dy:${(Math.sin(angle) * 5).toFixed(1)}px`,
          ].join(";");
        },
        blockStyleOf: delayStyleOf,
      },
    };
  }, [active, animation, memory]);
}
