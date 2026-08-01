/*
 * Colour maths for the picker, kept out of the component so a conversion can be
 * checked without a DOM.
 *
 * One canonical form travels through the app: `rgb(r g b / a%)`, which is what
 * the palette stores and what `style.setProperty` is handed. Hex exists here
 * only because it is what people type and paste.
 */

export interface Rgba {
  /** 0–255. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0–100, as a percentage, because that is how it is stored and shown. */
  readonly a: number;
}

export interface Hsva {
  /** 0–360. */
  readonly h: number;
  /** 0–1. */
  readonly s: number;
  /** 0–1. */
  readonly v: number;
  /** 0–100. */
  readonly a: number;
}

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

const channel = (value: number): number => Math.round(clamp(value, 0, 255));

/** Alpha keeps one decimal: a slider in whole percent never needs more. */
const alpha = (value: number): number => Math.round(clamp(value, 0, 100) * 10) / 10;

const HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
/* Out-of-range and negative channels are matched so they can be clamped: a
   pasted `rgb(300 -4 0)` is a colour someone meant, not a parse failure. */
const NUMBER = String.raw`-?[\d.]+`;
const RGB_FUNCTION = new RegExp(
  `^rgba?\\(\\s*(${NUMBER})[\\s,]+(${NUMBER})[\\s,]+(${NUMBER})(?:\\s*[/,]\\s*(${NUMBER})(%?))?\\s*\\)$`,
  "i",
);

const expandShorthand = (hex: string): string =>
  hex.length <= 5 ? `#${hex.slice(1).replace(/./g, (digit) => `${digit}${digit}`)}` : hex;

/**
 * Every shape a human might reasonably paste: `#abc`, `#abcd`, `#rrggbb`,
 * `#rrggbbaa`, `rgb(r g b)`, `rgb(r g b / a%)`, and the legacy comma forms.
 *
 * A bare `rgb(… / 0.5)` without the percent sign is read as a 0–1 fraction,
 * because that is what CSS means by it — writing `0.5%` when you meant half
 * opacity is a mistake worth not making on the user's behalf.
 */
export function parseColor(input: string): Rgba | undefined {
  const text = input.trim();

  if (HEX.test(text)) {
    const hex = expandShorthand(text).slice(1);
    const numeric = Number.parseInt(hex.slice(0, 6), 16);
    const opacity = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return {
      r: (numeric >> 16) & 255,
      g: (numeric >> 8) & 255,
      b: numeric & 255,
      a: alpha(opacity * 100),
    };
  }

  const parts = RGB_FUNCTION.exec(text);
  if (parts === null) return undefined;

  const opacity = parts[4] === undefined ? 100 : Number(parts[4]) * (parts[5] === "%" ? 1 : 100);
  return {
    r: channel(Number(parts[1])),
    g: channel(Number(parts[2])),
    b: channel(Number(parts[3])),
    a: alpha(opacity),
  };
}

/** The canonical form: what gets stored and what CSS is handed. */
export const formatColor = (color: Rgba): string =>
  `rgb(${String(channel(color.r))} ${String(channel(color.g))} ${String(channel(color.b))} / ${String(alpha(color.a))}%)`;

/**
 * What the text field shows. Hex, because that is what people recognise and
 * what they will paste back in — extended to eight digits only when there is
 * transparency to carry, so a fully opaque colour never reads as `#ffffffff`.
 */
export function formatHex(color: Rgba): string {
  const pair = (value: number) => channel(value).toString(16).padStart(2, "0");
  const rgb = `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
  if (color.a >= 100) return rgb;
  return `${rgb}${pair((color.a / 100) * 255)}`;
}

export function rgbaToHsva(color: Rgba): Hsva {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return { h: hue, s: max === 0 ? 0 : delta / max, v: max, a: color.a };
}

export function hsvaToRgba(color: Hsva): Rgba {
  const chroma = color.v * color.s;
  const second = chroma * (1 - Math.abs(((color.h / 60) % 2) - 1));
  const lift = color.v - chroma;
  const [red, green, blue] =
    color.h < 60
      ? [chroma, second, 0]
      : color.h < 120
        ? [second, chroma, 0]
        : color.h < 180
          ? [0, chroma, second]
          : color.h < 240
            ? [0, second, chroma]
            : color.h < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];

  return {
    r: channel((red + lift) * 255),
    g: channel((green + lift) * 255),
    b: channel((blue + lift) * 255),
    a: alpha(color.a),
  };
}
