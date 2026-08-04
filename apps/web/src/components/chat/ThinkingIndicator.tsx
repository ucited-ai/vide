import { type ChatThinkingIndicator } from "@vide/contracts/settings";
import { useLayoutEffect, useState } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { chatThinkingIndicatorPainter } from "./chatAppearance";

/**
 * What a turn looks like while it is still running.
 *
 * One canvas rather than a row of pulsing dots: the variants are fields of
 * dots that move against each other, which no arrangement of DOM nodes and
 * keyframes gets to for free. The painters are pure and live next door in
 * `thinkingIndicatorPainters.ts`; this owns the clock, the pixels and the
 * lifecycle.
 *
 * It takes its size from CSS and, unless the user has chosen a colour, its colour
 * from `currentColor` — so it sits in a line of text the way a glyph does and the
 * stylesheet stays in charge of both.
 */

/** Seconds of painter time per wall-clock second. The mock's tempo, kept. */
const INDICATOR_CLOCK = 3.6;

/** What the indicator holds on when motion is not wanted: mid-cycle, so no variant reads as empty. */
const STILL_FRAME = 0.6;

const FALLBACK_SIZE = 14;

export function ThinkingIndicator({
  variant,
  color = null,
  frozen = false,
}: {
  readonly variant: ChatThinkingIndicator;
  /**
   * The colour the user chose, as the palette stores one (`rgb(r g b / a%)`).
   *
   * Handed in rather than read off computed style like the fallback is: a colour
   * that lives in a setting has to reach the canvas the moment it changes, and a
   * value read once per layout would keep painting the old one until the line
   * around it happened to resize.
   */
  readonly color?: string | null;
  /**
   * Hold a single frame instead of running.
   *
   * What a finished turn leaves behind: the indicator stays in the line it has
   * been in all along rather than being swapped for a tick, so nothing about the
   * row moves as the turn settles — it simply stops.
   */
  readonly frozen?: boolean;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const { resolvedTheme } = useTheme();
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useLayoutEffect(() => {
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const paint = chatThinkingIndicatorPainter(variant);
    let frame = 0;
    let size = 0;
    let tint = "128,128,128";

    const measure = () => {
      const devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
      size = Math.round(canvas.getBoundingClientRect().width) || FALLBACK_SIZE;
      canvas.width = Math.round(size * devicePixelRatio);
      canvas.height = Math.round(size * devicePixelRatio);
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      // `currentColor` resolved once per layout rather than per frame: reading
      // computed style is a style recalculation, and 60 of those a second for a
      // colour that only moves with the theme is not a trade worth making.
      tint = ((color ?? getComputedStyle(canvas).color).match(/\d+/g) ?? ["128", "128", "128"])
        .slice(0, 3)
        .join(",");
    };

    const render = (time: number) => {
      const centre = size / 2;
      const radius = centre * 0.86;
      // Dots grow with the square-ish root of the indicator, so a small one
      // stays legible instead of dissolving into specks.
      const scale = (size / 300) ** 0.6;

      const dots = [...paint(time, radius, scale)].sort((left, right) => left.z - right.z);
      context.clearRect(0, 0, size, size);
      for (const dot of dots) {
        context.fillStyle = `rgba(${tint},${Math.min(1, Math.max(0, dot.a))})`;
        context.beginPath();
        context.arc(centre + dot.x, centre - dot.y, Math.max(0.3, dot.r), 0, Math.PI * 2);
        context.fill();
      }
    };

    const step = () => {
      render((performance.now() / 1000) * INDICATOR_CLOCK);
      frame = requestAnimationFrame(step);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      measure();
      if (prefersReducedMotion || frozen) {
        render(STILL_FRAME);
        return;
      }
      step();
    };

    // Painted synchronously, before the row's first frame reaches the screen —
    // a layout effect, because the ResizeObserver's initial delivery is
    // asynchronous and the send-to-indicator hitch was exactly the frames spent
    // waiting for it. The observer stays on for re-measures only; its first
    // delivery re-running `start` is idempotent.
    const observer = new ResizeObserver(start);
    observer.observe(canvas);
    start();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [canvas, color, frozen, prefersReducedMotion, resolvedTheme, variant]);

  return (
    <span aria-hidden="true" className="chat-thinking-indicator">
      <canvas ref={setCanvas} />
    </span>
  );
}
