"use client";

/*
 * The colour picker. There is one, and this is it.
 *
 * `react-colorful` was the obvious candidate and was rejected on the balance of
 * work: it ships its own DOM under `.react-colorful__*`, and making that carry
 * the app's radii, edges and shadows costs more stylesheet than the three
 * pointer handlers below cost TypeScript — while putting the picker's appearance
 * somewhere no component references. The plane, the hue slider and the handle
 * style here are the ones the provider accent picker already had; alpha, the
 * eyedropper, the text field and the presets are what it was missing.
 *
 * One surface, deliberately. The iOS picker this was measured against offers
 * grid, spectrum and sliders as three tabs, which is three decisions to make
 * before choosing a colour.
 */

import { PipetteIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import {
  type Hsva,
  type Rgba,
  clamp,
  formatColor,
  formatHex,
  hsvaToRgba,
  parseColor,
  rgbaToHsva,
} from "./color-picker.logic";

/** What the plane opens on when it is handed something it cannot read. */
const UNREADABLE_VALUE_FALLBACK: Rgba = { r: 128, g: 128, b: 128, a: 100 };

export interface ColorPickerPreset {
  readonly label: string;
  /** Canonical `rgb(r g b / a%)`, like everything else the picker speaks. */
  readonly value: string;
}

/**
 * The transparency backdrop.
 *
 * A conic gradient rather than an image so it costs nothing to load and follows
 * the theme: the squares are the app's own wash over the surface beneath, which
 * keeps a half-transparent colour readable in light and dark without two
 * hardcoded greys.
 */
const CHECKERBOARD =
  "conic-gradient(var(--wash-active) 0 25%, transparent 0 50%, var(--wash-active) 0 75%, transparent 0)";

const CHECKERBOARD_STYLE = {
  backgroundImage: CHECKERBOARD,
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 4px 4px",
} as const;

/** Drag anywhere in the field once the pointer is down, including outside it. */
function useDragHandler(onMove: (event: ReactPointerEvent<HTMLDivElement>) => void) {
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      onMove(event);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) onMove(event);
    },
  };
}

/** The shared handle: a white ring with a hairline shadow, over the live colour. */
function Handle({ className, style }: { className?: string; style: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]",
        className,
      )}
      style={style}
    />
  );
}

export function ColorPicker({
  value,
  onChange,
  presets,
  showAlpha = true,
  className,
}: {
  /** Any form `parseColor` understands; `rgb(r g b / a%)` comes back out. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly presets?: ReadonlyArray<ColorPickerPreset>;
  /**
   * Opacity is only offered where it does something. Only the chrome rung is
   * ever painted translucent, so a slider on the others would be a control that
   * changes nothing — see `--surface-chrome-alpha` in `vide-theme.css`.
   */
  readonly showAlpha?: boolean;
  readonly className?: string;
}) {
  const parsed = useMemo(() => parseColor(value), [value]);
  const [hsva, setHsva] = useState<Hsva>(() => rgbaToHsva(parsed ?? UNREADABLE_VALUE_FALLBACK));
  const [draft, setDraft] = useState<string | undefined>(undefined);

  /*
   * The plane keeps its own hue and saturation because RGB cannot hold them: at
   * zero saturation every hue is the same grey, so round-tripping through the
   * committed value would snap the handle to red the moment someone dragged to
   * the white edge. Only an incoming value that is genuinely a different colour
   * resets it.
   */
  useEffect(() => {
    if (parsed === undefined) return;
    setHsva((current) => {
      const currentRgba = hsvaToRgba(current);
      const same =
        currentRgba.r === parsed.r &&
        currentRgba.g === parsed.g &&
        currentRgba.b === parsed.b &&
        currentRgba.a === parsed.a;
      return same ? current : rgbaToHsva(parsed);
    });
  }, [parsed]);

  const commit = useCallback(
    (next: Hsva) => {
      setHsva(next);
      setDraft(undefined);
      onChange(formatColor(hsvaToRgba(next)));
    },
    [onChange],
  );

  const rgba = hsvaToRgba(hsva);
  const opaque = formatColor({ ...rgba, a: 100 });
  const hue = `hsl(${String(Math.round(hsva.h))} 100% 50%)`;

  const fromPlane = useDragHandler((event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    commit({
      ...hsva,
      s: clamp((event.clientX - bounds.left) / bounds.width),
      v: 1 - clamp((event.clientY - bounds.top) / bounds.height),
    });
  });

  const fromHue = useDragHandler((event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    commit({ ...hsva, h: clamp((event.clientX - bounds.left) / bounds.width) * 360 });
  });

  const fromAlpha = useDragHandler((event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    commit({ ...hsva, a: clamp((event.clientX - bounds.left) / bounds.width) * 100 });
  });

  /*
   * Picking a colour off the screen is a Chromium-only capability today. Where
   * it is missing the button is absent rather than disabled: a control that can
   * never work is worse than one that was never offered.
   */
  const eyeDropper = useMemo(() => {
    const constructor = (
      window as typeof window & {
        EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
      }
    ).EyeDropper;
    return constructor === undefined ? undefined : constructor;
  }, []);

  const pickFromScreen = useCallback(() => {
    if (eyeDropper === undefined) return;
    void new eyeDropper()
      .open()
      .then((result) => {
        const picked = parseColor(result.sRGBHex);
        if (picked === undefined) return;
        /* The screen has no transparency to report, so the current alpha stands. */
        commit(rgbaToHsva({ ...picked, a: hsva.a }));
      })
      /* Dismissing the eyedropper rejects. That is not an error. */
      .catch(() => undefined);
  }, [commit, eyeDropper, hsva.a]);

  return (
    <div className={cn("w-60", className)}>
      <div
        {...fromPlane}
        className="relative h-36 cursor-crosshair touch-none"
        style={{
          backgroundColor: hue,
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        }}
        role="presentation"
      >
        <Handle
          className="size-3"
          style={{ left: `${String(hsva.s * 100)}%`, top: `${String((1 - hsva.v) * 100)}%` }}
        />
      </div>

      <div className="grid gap-3 p-3">
        <div className="flex items-center gap-2.5">
          {/* The current colour, over the checkerboard so its alpha is visible. */}
          <span
            aria-hidden
            className="size-7 shrink-0 rounded-full border border-border"
            style={CHECKERBOARD_STYLE}
          >
            <span
              className="block size-full rounded-full"
              style={{ backgroundColor: formatColor(rgba) }}
            />
          </span>

          <div className="grid min-w-0 flex-1 gap-2">
            <div
              {...fromHue}
              className="relative h-3 cursor-pointer touch-none rounded-full"
              style={{
                background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
              }}
              role="presentation"
            >
              <Handle
                className="top-1/2 size-4"
                style={{ left: `${String((hsva.h / 360) * 100)}%`, backgroundColor: hue }}
              />
            </div>

            {showAlpha ? (
              <div
                {...fromAlpha}
                className="relative h-3 cursor-pointer touch-none rounded-full"
                style={CHECKERBOARD_STYLE}
                role="presentation"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ background: `linear-gradient(to right, transparent, ${opaque})` }}
                />
                <Handle
                  className="top-1/2 size-4"
                  style={{
                    left: `${String(hsva.a)}%`,
                    backgroundColor: formatColor(rgba),
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={draft ?? formatHex(rgba)}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setDraft(text);
              const next = parseColor(text);
              if (next === undefined) return;
              const hsvaNext = rgbaToHsva(next);
              /* Typing `#000` must not throw away the hue the plane is sitting on. */
              setHsva((current) => ({
                ...hsvaNext,
                h: next.r === next.g && next.g === next.b ? current.h : hsvaNext.h,
              }));
              onChange(formatColor(showAlpha ? next : { ...next, a: 100 }));
            }}
            onBlur={() => setDraft(undefined)}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-(length:--text-caption) text-foreground outline-none transition-colors focus:border-ring"
            aria-label="Colour value"
            spellCheck={false}
            autoComplete="off"
          />
          {eyeDropper === undefined ? null : (
            <button
              type="button"
              onClick={pickFromScreen}
              aria-label="Pick a colour from the screen"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PipetteIcon aria-hidden className="size-3.5" />
            </button>
          )}
        </div>

        {presets === undefined || presets.length === 0 ? null : (
          /* Somewhere to start from, so the first drag is not into an empty field. */
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((preset) => (
              <button
                key={`${preset.label}:${preset.value}`}
                type="button"
                title={preset.label}
                aria-label={preset.label}
                onClick={() => {
                  const next = parseColor(preset.value);
                  if (next !== undefined) commit(rgbaToHsva(next));
                }}
                className="size-5 rounded-full border border-border transition-colors hover:border-foreground/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                style={CHECKERBOARD_STYLE}
              >
                <span
                  aria-hidden
                  className="block size-full rounded-full"
                  style={{ backgroundColor: preset.value }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
