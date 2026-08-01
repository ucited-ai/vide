/**
 * The clock the word reveal runs on.
 *
 * The reveal used to be the provider's arrival pattern and nothing else, which
 * meant it depended on a setting most people never turn on: with
 * `enableAssistantStreaming` off the server buffers a segment and hands over the
 * whole paragraph in one delta, so every word was new in the same frame and the
 * "streaming" animation was one flash. The turn now reveals on its own clock —
 * word n of a delta waits n steps — so it reads the same either way, and real
 * streaming just makes the deltas smaller.
 *
 * Three rules keep it honest:
 *
 * - only a turn that is still running reveals anything. An old message that
 *   remounts because the list recycled its row must not replay a turn from last
 *   week;
 * - a delta's reveal finishes even if the turn settles under it. The buffered
 *   case ends with the text landing and the turn completing a moment later, so a
 *   reveal tied strictly to "is the turn running" would be cut off at the second
 *   word every single time;
 * - a word keeps the style it was born with. The baseline between "already on
 *   screen" and "new this delta" is the rendered tree's own word count, and a
 *   word once styled always re-renders byte-identical — so React keeps its DOM
 *   node, and the animation that already ran is never retimed or replayed.
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
 * `blur` at 820ms in `vide-theme.css`. It is only used to decide how long wrapping
 * outlives the turn, so erring long costs nothing and erring short cuts the last
 * words of an answer off mid-reveal.
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
 * The step for a delta of `wordCount` words — the natural one until a long delta
 * would outrun its own budget.
 */
export function chatStreamStepMs(wordCount: number, animation: ChatStreamAnimation): number {
  const groups =
    animation === "phrase" ? Math.max(1, Math.ceil(wordCount / PHRASE_WORDS)) : wordCount;
  const spans = Math.max(1, groups - 1);
  const factor = animation === "phrase" ? PHRASE_STEP_FACTOR : 1;
  return Math.min(WORD_STEP_MS, MAX_DELTA_REVEAL_MS / (spans * factor));
}

export function chatStreamDelayMs(
  indexInDelta: number,
  step: number,
  animation: ChatStreamAnimation,
): number {
  if (animation === "phrase") {
    return Math.floor(indexInDelta / PHRASE_WORDS) * step * PHRASE_STEP_FACTOR;
  }
  return indexInDelta * step + noise(indexInDelta) * step * 0.5;
}

/** How long the whole of a `wordCount`-word delta needs to finish revealing. */
export function chatStreamRevealMs(wordCount: number, animation: ChatStreamAnimation): number {
  if (wordCount <= 0) return 0;
  const step = chatStreamStepMs(wordCount, animation);
  return Math.round(chatStreamDelayMs(wordCount - 1, step, animation)) + WORD_MOTION_MS;
}

export interface ChatStreamRevealState {
  /** Whether this render should wrap words at all. */
  readonly active: boolean;
  readonly timing: ChatStreamWordTiming;
}

const NO_REVEAL: ChatStreamRevealState = {
  active: false,
  timing: {
    styleOf: () => null,
    reportWordCount: () => {},
  },
};

/**
 * Everything the reveal remembers between renders — and between mounts.
 *
 * Keyed by the message rather than held in a ref, because the component's
 * lifetime is not the message's: the virtualized list unmounts and remounts
 * rows as their heights churn, and a reveal whose bookkeeping died with the
 * component replayed the whole message on every remount. The map survives;
 * an entry is dropped when its message's reveal settles, and the cap sweeps
 * up entries whose rows unmounted mid-turn and never came back.
 */
interface ChatStreamRevealMemory {
  text: string;
  /** Source-token count of `text` — pacing only, never a baseline. */
  sourceWordCount: number;
  /** Source-token size of the newest delta, for how long its reveal runs. */
  lastDeltaWordCount: number;
  /** What the rendered tree held after the last walk: the next delta's baseline. */
  treeWordCount: number;
  /** Tree index the current delta starts at. */
  baseline: number;
  /** The current delta's step, frozen when the delta arrives. */
  step: number;
  /**
   * What each word was born with, by absolute tree index. While a word's
   * animation may still be running it keeps its exact style, so its markup
   * re-renders byte-identical and React never touches its DOM; once its
   * window has passed (`restAtMs`) it is at rest — `style: null` — and rests
   * are rendered as plain spans, so a remounted row cannot animate them:
   * a CSS animation fires on any first paint, not only the first ever.
   */
  wordsByIndex: Map<number, { style: string | null; restAtMs: number }>;
}

const REVEAL_MEMORY_CAP = 64;
const revealMemoryByKey = new Map<string, ChatStreamRevealMemory>();

function acquireRevealMemory(key: string): ChatStreamRevealMemory {
  const existing = revealMemoryByKey.get(key);
  if (existing) return existing;
  const fresh: ChatStreamRevealMemory = {
    text: "",
    sourceWordCount: 0,
    lastDeltaWordCount: 0,
    treeWordCount: 0,
    baseline: 0,
    step: WORD_STEP_MS,
    wordsByIndex: new Map(),
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
  const memory = acquireRevealMemory(memoryKey);

  /*
   * Advance the delta during render — the words animate on the render that
   * creates them, and a baseline arriving one commit later would be a baseline
   * for the delta before. Starting from an empty `text` is what makes the
   * buffered case work: a message that mounts with its text already whole
   * reveals all of it.
   */
  if (memory.text !== input.text && reveals) {
    const sourceWordCount = countStreamWords(input.text);
    memory.lastDeltaWordCount = Math.max(1, sourceWordCount - memory.sourceWordCount);
    memory.step = chatStreamStepMs(memory.lastDeltaWordCount, animation);
    memory.baseline = memory.treeWordCount;
    memory.text = input.text;
    memory.sourceWordCount = sourceWordCount;
  }

  const deltaRevealMs =
    animation === undefined || animation === "instant"
      ? 0
      : chatStreamRevealMs(memory.lastDeltaWordCount, animation);

  /*
   * Wrapping outlives `reveals` by one delta's worth of time, so the last thing
   * a turn writes still arrives word by word after the turn is marked complete.
   */
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (reveals) {
      setSettling(true);
      return;
    }
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), deltaRevealMs);
    return () => clearTimeout(timer);
  }, [deltaRevealMs, reveals, settling]);

  const active = (reveals || settling) && animation !== undefined && animation !== "instant";

  /* A settled message keeps no bookkeeping around — and must not, or the map
     would hold every message the session ever revealed. Dropped only when the
     reveal settles while mounted; an unmount mid-turn deliberately leaves the
     entry, because surviving that unmount is the map's whole purpose. */
  useEffect(() => {
    if (active) return;
    revealMemoryByKey.delete(memoryKey);
  }, [active, memoryKey]);

  return useMemo(() => {
    if (!active || animation === undefined) return NO_REVEAL;
    return {
      active: true,
      timing: {
        styleOf: (index: number): string | null => {
          const known = memory.wordsByIndex.get(index);
          if (known !== undefined) {
            /* Its animation window has passed: from here on the word renders
               as a plain span, so a remounted row cannot animate it again. */
            if (known.style !== null && Date.now() >= known.restAtMs) {
              known.style = null;
            }
            return known.style;
          }
          if (index < memory.baseline) {
            /*
             * On screen before this delta and never styled while we watched —
             * at rest. A delay grown onto it now would put it back inside its
             * own delay phase, where `animation-fill-mode: backwards` hides
             * it: the word would blink out because a later word arrived.
             */
            memory.wordsByIndex.set(index, { style: null, restAtMs: 0 });
            return null;
          }
          const indexInDelta = index - memory.baseline;
          const delayMs = Math.round(chatStreamDelayMs(indexInDelta, memory.step, animation));
          const angle = noise(index) * Math.PI * 2;
          const style = [
            `--chat-stream-delay:${String(delayMs)}ms`,
            `--chat-stream-dx:${(Math.cos(angle) * 8).toFixed(1)}px`,
            `--chat-stream-dy:${(Math.sin(angle) * 5).toFixed(1)}px`,
          ].join(";");
          memory.wordsByIndex.set(index, {
            style,
            restAtMs: Date.now() + delayMs + WORD_MOTION_MS,
          });
          return style;
        },
        reportWordCount: (count: number) => {
          memory.treeWordCount = count;
        },
      },
    };
  }, [active, animation, memory, memoryKey]);
}
