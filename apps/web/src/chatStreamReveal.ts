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
 * Two rules keep it honest:
 *
 * - only a turn that is still running reveals anything. An old message that
 *   remounts because the list recycled its row must not replay a turn from last
 *   week;
 * - a delta's reveal finishes even if the turn settles under it. The buffered
 *   case ends with the text landing and the turn completing a moment later, so a
 *   reveal tied strictly to "is the turn running" would be cut off at the second
 *   word every single time.
 */

import { type ChatStreamAnimation } from "@vide/contracts/settings";
import { useEffect, useMemo, useState } from "react";

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
    revealedWordCount: 0,
    delayMsOf: () => 0,
    offsetOf: () => ({ dx: "0px", dy: "0px" }),
  },
};

export function useChatStreamReveal(input: {
  readonly text: string;
  readonly animation: ChatStreamAnimation | undefined;
  /** Whether the turn this text belongs to is still running. */
  readonly live: boolean;
}): ChatStreamRevealState {
  const animation = input.animation;
  const reveals = input.live && animation !== undefined && animation !== "instant";

  /*
   * The word count the previous text had, so only what this render adds animates.
   *
   * Held as state and corrected during render rather than in an effect: the words
   * animate on the render that creates them, and a baseline arriving one commit
   * later would be a baseline for the delta before. Starting at zero is what
   * makes the buffered case work — a message that mounts with its text already
   * whole reveals all of it.
   */
  const [seen, setSeen] = useState({ text: input.text, revealed: 0 });
  if (seen.text !== input.text) {
    setSeen({ text: input.text, revealed: countStreamWords(seen.text) });
  }
  const revealedWordCount = seen.text === input.text ? seen.revealed : countStreamWords(seen.text);

  const deltaWordCount = Math.max(0, countStreamWords(input.text) - revealedWordCount);
  const deltaRevealMs =
    animation === undefined || animation === "instant"
      ? 0
      : chatStreamRevealMs(deltaWordCount, animation);

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

  return useMemo(() => {
    if (!active || animation === undefined) return NO_REVEAL;
    const step = chatStreamStepMs(deltaWordCount, animation);
    return {
      active: true,
      timing: {
        revealedWordCount,
        delayMsOf: (indexInDelta) => chatStreamDelayMs(indexInDelta, step, animation),
        offsetOf: (indexInDelta) => {
          const angle = noise(revealedWordCount + indexInDelta) * Math.PI * 2;
          return {
            dx: `${(Math.cos(angle) * 8).toFixed(1)}px`,
            dy: `${(Math.sin(angle) * 5).toFixed(1)}px`,
          };
        },
      },
    };
  }, [active, animation, deltaWordCount, revealedWordCount]);
}
