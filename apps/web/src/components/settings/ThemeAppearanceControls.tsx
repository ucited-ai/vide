"use client";

/*
 * The two controls the Theme panel grew: how big the text is, and what the six
 * colours are.
 *
 * They live here rather than inline in `ThemeSettingsPanel` because between them
 * they are most of that file, and because the panel's job is to be a short list
 * of rows — ten rows of controls is a table, not a settings screen.
 *
 * Nothing here says `--surface-chrome` or `#232429` out loud. The user picks
 * "Sidebar & menus" and sees the result; the token name and the hex are the
 * implementation, and putting them on screen is how a settings page starts
 * reading like a config file.
 */

import {
  DEFAULT_CHAT_INDICATOR_COLOR,
  DEFAULT_PALETTE,
  DEFAULT_TEXT_SCALE,
  GLASS_BLUR_STEP,
  MAX_GLASS_BLUR,
  MAX_TEXT_SCALE,
  MIN_GLASS_BLUR,
  MIN_TEXT_SCALE,
  PALETTE_SLOTS,
  type PaletteSlot,
  TEXT_SCALE_STEP,
  type ThemePalette,
  hexToPaletteColor,
} from "@vide/contracts";
import { type CSSProperties, useEffect, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { ColorPicker, type ColorPickerPreset } from "../ui/color-picker";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

/*
 * What each rung is called to someone who has never read the stylesheet, in the
 * order they sit in: surfaces from the floor up, then three weights of text
 * from strongest to faintest. One label, one surface family — the sidebar, the
 * panels the user acts through (composer, environment column) and the popups
 * (menus, dialogs, toasts) are separate swatches because they are separately
 * tintable rungs.
 */
const SLOT_LABELS: Readonly<Record<PaletteSlot, string>> = {
  "surface-content": "Chat background",
  "surface-recessed": "Context bar",
  "surface-sidebar": "Sidebar",
  "surface-panel": "Chat input & side panels",
  "surface-chrome": "Menus, dialogs & tooltips",
  ink: "Text",
  "ink-secondary": "Secondary text",
  "ink-tertiary": "Faint text",
};

/*
 * The word that fits under a 28px swatch. The full label stays in the tooltip
 * and the picker; this is the one-word answer to "which dot was that again",
 * which the row used to leave to hovering.
 */
const SLOT_CAPTIONS: Readonly<Record<PaletteSlot, string>> = {
  "surface-content": "Chat",
  "surface-recessed": "Context",
  "surface-sidebar": "Sidebar",
  "surface-panel": "Input",
  "surface-chrome": "Menus",
  ink: "Text",
  "ink-secondary": "Muted",
  "ink-tertiary": "Faint",
};

/* The surfaces with the window's vibrancy material behind them. Ink never
   takes an alpha — ink that wants to be lighter can be a lighter grey. */
const SLOTS_TAKING_OPACITY: ReadonlySet<PaletteSlot> = new Set([
  "surface-chrome",
  "surface-sidebar",
  "surface-panel",
  "surface-content",
  "surface-recessed",
]);

/* The rungs that ride the chrome tone until the user splits them off — they
   share chrome's presets, so "somewhere to start" stays one list. */
const CHROME_FAMILY_SLOTS: ReadonlySet<PaletteSlot> = new Set([
  "surface-chrome",
  "surface-sidebar",
  "surface-panel",
]);

/**
 * The tints the surface-tint setting used to offer, kept as somewhere to start.
 *
 * They were chosen as steps along "how far chrome stands off the window", which
 * is still the axis most people want, and losing them would have made the free
 * picker strictly worse than the six swatches it replaced.
 */
const CHROME_PRESET_HEXES: Readonly<Record<"light" | "dark", ReadonlyArray<[string, string]>>> = {
  dark: [
    ["Flat", "#1b1c20"],
    ["Raised", "#2b2c32"],
    ["Elevated", "#33343a"],
    ["Warm", "#262429"],
    ["Cool", "#20242b"],
  ],
  light: [
    ["Flat", "#f7f7f8"],
    ["Raised", "#ffffff"],
    ["Warm", "#fdfcfa"],
    ["Cool", "#fafbfd"],
  ],
};

type ProbedColors = Readonly<Record<"light" | "dark", Readonly<Record<string, string>>>>;

const EMPTY_PROBED_COLORS: ProbedColors = { light: {}, dark: {} };

/**
 * What the stylesheet is painting, for both themes at once.
 *
 * Read off a hidden probe rather than copied into a table here: the values are
 * decided in `vide-theme.css`, and a second copy in TypeScript would be wrong the
 * first time anyone tunes one. The probe carries the opposite theme's class,
 * which is the only way to see the other half of the theme without switching the
 * app to it.
 *
 * Keyed by the property name so anything the theme declares can be read the same
 * way — the ladder, and the colours the indicator offers as a place to start.
 */
function useProbedColors(properties: ReadonlyArray<string>): ProbedColors {
  const [colors, setColors] = useState<ProbedColors>(EMPTY_PROBED_COLORS);
  const key = properties.join(" ");

  useEffect(() => {
    /* Attached but not painted: custom properties only resolve for an element
       that is actually in the document, and `hidden` costs nothing to lay out. */
    const probe = document.createElement("div");
    probe.hidden = true;
    document.body.append(probe);

    const read = (theme: "light" | "dark") => {
      probe.className = theme === "dark" ? "dark" : "";
      const computed = getComputedStyle(probe);
      const values: Record<string, string> = {};
      for (const property of key.split(" ")) {
        const value = computed.getPropertyValue(property).trim();
        if (value !== "") values[property] = value;
      }
      return values;
    };

    setColors({ light: read("light"), dark: read("dark") });
    probe.remove();
    // The list is a fixed table at the module level; the joined key is what keeps
    // the effect from re-running on a new array with the same contents.
  }, [key]);

  return colors;
}

const LADDER_PROPERTIES = PALETTE_SLOTS.map((slot) => `--${slot}`);

/**
 * The colours the indicator offers as a place to start.
 *
 * A grey for staying monochrome and three hues quiet enough that a running turn
 * is noticed without the app gaining a brand. The values are decided in
 * `vide-theme.css` beside everything else that is a colour — these are only the
 * names to read them back under.
 */
const INDICATOR_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["Grey", "--chat-indicator-grey"],
  ["Green", "--chat-indicator-green"],
  ["Amber", "--chat-indicator-amber"],
  ["Blue", "--chat-indicator-blue"],
];

const INDICATOR_PRESET_PROPERTIES = INDICATOR_PRESETS.map(([, property]) => property);

/** A colour the picker can hold, whatever form the stylesheet wrote it in. */
function toPickerValue(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return color.startsWith("#") ? hexToPaletteColor(color) : color;
}

function SwatchButton({
  label,
  color,
  presets,
  showAlpha = false,
  onChange,
}: {
  readonly label: string;
  readonly color: string;
  readonly presets: ReadonlyArray<ColorPickerPreset>;
  readonly showAlpha?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={label}
                  className={cn(
                    "size-7 shrink-0 cursor-pointer rounded-full border border-border transition-[scale,border-color]",
                    "hover:scale-105 hover:border-foreground/40 active:scale-95",
                    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  /* The checkerboard shows through wherever the colour does not. */
                  style={{
                    backgroundImage:
                      "conic-gradient(var(--wash-active) 0 25%, transparent 0 50%, var(--wash-active) 0 75%, transparent 0)",
                    backgroundSize: "8px 8px",
                  }}
                >
                  <span
                    aria-hidden
                    className="block size-full rounded-full"
                    style={{ backgroundColor: color }}
                  />
                </button>
              }
            />
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        side="bottom"
        align="end"
        sideOffset={6}
        className="overflow-hidden rounded-md p-0 [--viewport-inline-padding:0px] [&_[data-slot=popover-viewport]]:p-0"
      >
        <ColorPicker value={color} onChange={onChange} presets={presets} showAlpha={showAlpha} />
      </PopoverPopup>
    </Popover>
  );
}

export function ThemeColorsRow() {
  const palette = useClientSettings((settings) => settings.palette);
  const updateSettings = useUpdateClientSettings();
  const { resolvedTheme } = useTheme();
  const ladder = useProbedColors(LADDER_PROPERTIES);

  /*
   * The swatches edit the theme currently on screen, because that is the only
   * one whose result the user can see while choosing. Switching Appearance above
   * therefore switches which half of the setting this row edits.
   */
  const active: ThemePalette = palette[resolvedTheme];
  const other = resolvedTheme === "dark" ? "light" : "dark";
  const isDefault = PALETTE_SLOTS.every(
    (slot) => palette.light[slot] === null && palette.dark[slot] === null,
  );

  const write = (slot: PaletteSlot, value: string) =>
    updateSettings({
      palette: { ...palette, [resolvedTheme]: { ...active, [slot]: value } },
    });

  const presetsFor = (slot: PaletteSlot): ReadonlyArray<ColorPickerPreset> => {
    const entries: Array<ColorPickerPreset> = [];
    const push = (label: string, value: string | undefined) => {
      if (value !== undefined && !entries.some((entry) => entry.value === value)) {
        entries.push({ label, value });
      }
    };
    /* What this rung is today, so "undo my drag" is one click away. */
    push(`${SLOT_LABELS[slot]}, as designed`, toPickerValue(ladder[resolvedTheme][`--${slot}`]));
    push(`${SLOT_LABELS[slot]} in ${other}`, toPickerValue(ladder[other][`--${slot}`]));
    if (CHROME_FAMILY_SLOTS.has(slot)) {
      for (const [label, hex] of CHROME_PRESET_HEXES[resolvedTheme]) {
        push(label, hexToPaletteColor(hex));
      }
    }
    return entries;
  };

  const swatch = (slot: PaletteSlot) => (
    <div key={slot} className="flex flex-col items-center gap-1">
      <SwatchButton
        label={SLOT_LABELS[slot]}
        /* A rung the user has not chosen shows what the stylesheet is painting. */
        color={active[slot] ?? ladder[resolvedTheme][`--${slot}`] ?? "transparent"}
        presets={presetsFor(slot)}
        showAlpha={SLOTS_TAKING_OPACITY.has(slot)}
        onChange={(value) => write(slot, value)}
      />
      <span className="text-(length:--text-micro) leading-none text-(--ink-tertiary)">
        {SLOT_CAPTIONS[slot]}
      </span>
    </div>
  );

  return (
    <SettingsRow
      title="Colours"
      description={`Five surfaces and three weights of text. Surfaces can carry an opacity — below 100% the surface becomes glass and shows what is behind it. Everything else — borders, hovers, the focus ring — follows from these eight. Stored separately for light and dark; you are editing ${resolvedTheme}.`}
      resetAction={
        isDefault ? null : (
          <SettingResetButton
            label="colours"
            onClick={() => updateSettings({ palette: DEFAULT_PALETTE })}
          />
        )
      }
      control={
        /* Surfaces and text as two groups, so the row reads as two decisions
           rather than six. */
        <div className="flex items-start gap-3">
          <div className="flex items-start gap-1.5">
            {swatch("surface-content")}
            {swatch("surface-recessed")}
            {swatch("surface-sidebar")}
            {swatch("surface-panel")}
            {swatch("surface-chrome")}
          </div>
          <span aria-hidden className="mt-1 h-5 w-px bg-border" />
          <div className="flex items-start gap-1.5">
            {swatch("ink")}
            {swatch("ink-secondary")}
            {swatch("ink-tertiary")}
          </div>
        </div>
      }
    />
  );
}

/**
 * The one colour the app offers that is not a rung of the ladder.
 *
 * The indicator is only ever on screen while a turn is running, which is what
 * makes it the one place a colour cannot leak into the rest of the app: nothing
 * is painted from it and nothing sits beside it for long. Unset — the default —
 * it takes the colour of the line it is in, which is the monochrome answer.
 *
 * It lives in the Chat section rather than in Colours because it is a property of
 * the indicator, not of the palette; and in the settings rather than in a chat
 * toolbar, because it is chosen once and then never thought about again.
 */
export function ChatIndicatorColorRow() {
  const chatIndicatorColor = useClientSettings((settings) => settings.chatIndicatorColor);
  const updateSettings = useUpdateClientSettings();
  const { resolvedTheme } = useTheme();
  const ink = useProbedColors(LADDER_PROPERTIES)[resolvedTheme]["--ink"];
  const presetColors = useProbedColors(INDICATOR_PRESET_PROPERTIES)[resolvedTheme];
  const chosen = chatIndicatorColor[resolvedTheme];
  /* Unset, the indicator is the colour of the line it sits in — so that is what
     the swatch shows, rather than an empty circle. */
  const followsText = toPickerValue(ink) ?? "transparent";

  return (
    <SettingsRow
      title="Indicator colour"
      description={`What the live indicator is painted in while a turn runs. Unset, it takes the colour of the line it sits in. Stored separately for light and dark; you are editing ${resolvedTheme}.`}
      resetAction={
        chatIndicatorColor.light === null && chatIndicatorColor.dark === null ? null : (
          <SettingResetButton
            label="indicator colour"
            onClick={() => updateSettings({ chatIndicatorColor: DEFAULT_CHAT_INDICATOR_COLOR })}
          />
        )
      }
      control={
        <SwatchButton
          color={chosen ?? followsText}
          label="Indicator colour"
          presets={INDICATOR_PRESETS.flatMap(([label, property]) => {
            const value = toPickerValue(presetColors[property]);
            return value === undefined ? [] : [{ label, value }];
          })}
          onChange={(value) =>
            updateSettings({
              chatIndicatorColor: { ...chatIndicatorColor, [resolvedTheme]: value },
            })
          }
        />
      }
    />
  );
}

const GLASS_BLUR_PROPERTIES = ["--glass-blur"];

/**
 * How strongly translucent surfaces frost what is behind them.
 *
 * One slider for the whole app: sidebar, chat background, composer, menus and
 * dialogs all frost with the same strength, because two panes of one window
 * frosted differently read as two materials. It only shows at all where a
 * surface's opacity is below 100% — an opaque fill has nothing behind it to
 * frost — which the description says out loud, since a slider that visibly
 * does nothing is worse than no slider.
 */
export function GlassBlurRow() {
  const glassBlur = useClientSettings((settings) => settings.glassBlur);
  const updateSettings = useUpdateClientSettings();
  const { resolvedTheme } = useTheme();
  /* The stylesheet's per-theme default, read back rather than copied here. */
  const probedDefault = useProbedColors(GLASS_BLUR_PROPERTIES)[resolvedTheme]["--glass-blur"];
  const themeDefault = Number.parseFloat(probedDefault ?? "12");
  const effective = glassBlur ?? (Number.isFinite(themeDefault) ? themeDefault : 12);

  const progress = (effective - MIN_GLASS_BLUR) / (MAX_GLASS_BLUR - MIN_GLASS_BLUR);
  const sliderStyle = {
    "--settings-slider-progress": `${String(progress * 100)}%`,
  } as CSSProperties;

  return (
    <SettingsRow
      title="Glass blur"
      description="How strongly see-through surfaces frost what is behind them. Only visible where a colour's opacity is below 100% — turn a surface's opacity down first, then tune the frost here."
      resetAction={
        glassBlur === null ? null : (
          <SettingResetButton
            label="glass blur"
            onClick={() => updateSettings({ glassBlur: null })}
          />
        )
      }
      control={
        <div className="flex w-full items-center gap-3 sm:w-52">
          <output
            className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-(length:--text-caption) font-medium tabular-nums text-foreground"
            htmlFor="glass-blur"
          >
            {glassBlur === null ? `${String(effective)}px` : `${String(glassBlur)}px`}
          </output>
          <input
            aria-label="Glass blur"
            className="settings-slider min-w-0 flex-1"
            id="glass-blur"
            max={MAX_GLASS_BLUR}
            min={MIN_GLASS_BLUR}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (next >= MIN_GLASS_BLUR && next <= MAX_GLASS_BLUR) {
                updateSettings({ glassBlur: next });
              }
            }}
            step={GLASS_BLUR_STEP}
            style={sliderStyle}
            type="range"
            value={effective}
          />
        </div>
      }
    />
  );
}

/**
 * A miniature of the app, floating on a fixed wallpaper.
 *
 * It is not a mock: every surface here reads the same custom property the real
 * surface paints — the sidebar its `--sidebar-surface` and sidebar frost, the
 * composer its `--panel-surface` and panel frost, the menu the real
 * `dropdown-glass` class — so it cannot drift from the app, and a colour with
 * opacity shows the same glass here that it will show over the transcript.
 *
 * The wallpaper is the part the settings page cannot otherwise provide: glass
 * is invisible over a page painted in the same greys it is mixed from, which
 * is why the old preview looked broken the moment anyone touched opacity.
 * A static, colourful backdrop — deliberately not a theme colour — stands in
 * for the desktop behind the window, so transparency and blur are shown
 * rather than described. It never changes with the theme; only the window
 * floating on it does.
 *
 * It deliberately does not override the text scale locally: the six roles are
 * substituted at `:root`, so what inherits down here is already the live
 * setting — which is also the honest thing to show.
 */
export function ThemePreview() {
  const glassFilter = (variable: string): CSSProperties => ({
    backdropFilter: `var(${variable}, var(--chrome-backdrop-filter))`,
    WebkitBackdropFilter: `var(${variable}, var(--chrome-backdrop-filter))`,
  });

  return (
    <div
      aria-hidden
      className="mt-1 overflow-hidden rounded-xl border border-border"
      /* Its own stacking context, so every pane's blur samples the wallpaper
         rather than the settings page behind it. */
      style={{ isolation: "isolate" }}
    >
      <div
        className="relative p-4"
        /* The stand-in desktop. Static on purpose: the point is contrast
           behind the glass, not another themeable surface. */
        style={{
          background:
            "radial-gradient(52% 78% at 16% 18%, rgb(96 132 216 / 85%), transparent 70%)," +
            "radial-gradient(44% 64% at 84% 24%, rgb(214 138 110 / 75%), transparent 70%)," +
            "radial-gradient(60% 54% at 58% 88%, rgb(104 176 144 / 70%), transparent 72%)," +
            "linear-gradient(160deg, #2c3550, #171c2a)",
        }}
      >
        {/* The app window. */}
        <div className="relative flex h-44 overflow-hidden rounded-lg border border-black/20 shadow-[0_18px_40px_-18px_rgb(0_0_0/60%)]">
          {/* Sidebar — its own fill and frost, exactly like the real one. */}
          <div
            className="flex w-28 shrink-0 flex-col gap-1 border-r border-(--edge) bg-(--sidebar-surface) p-2"
            style={glassFilter("--sidebar-backdrop-filter")}
          >
            <span className="text-(length:--text-micro) font-medium tracking-wide text-(--ink-tertiary) uppercase">
              Sidebar
            </span>
            <span className="truncate rounded-md bg-(--wash-selected) px-1.5 py-0.5 text-(length:--text-ui) text-(--ink)">
              vide
            </span>
            <span className="truncate px-1.5 text-(length:--text-ui) text-(--ink-secondary)">
              relay
            </span>
          </div>

          {/* Chat pane — the content floor. */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-(--content-surface)">
            <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 pb-0">
              <span className="text-(length:--text-micro) font-medium tracking-wide text-(--ink-tertiary) uppercase">
                Chat background
              </span>
              <p className="text-(length:--text-chat) leading-[1.5] text-(--ink)">
                The transcript is read rather than scanned, so it runs a step larger.
              </p>
              <p className="text-(length:--text-caption) tabular-nums text-(--ink-tertiary)">
                14:32 · 1,204 tokens
              </p>
            </div>

            {/* The real popup surface: fill, frost, edge and shadow all come
                from dropdown-glass, so this is what every menu will look like. */}
            <div className="dropdown-glass absolute top-2 right-2 z-10 rounded-(--popup-radius) px-2 py-1.5">
              <div className="text-(length:--text-micro) tracking-wide text-(--ink-tertiary) uppercase">
                Menu
              </div>
              <div className="text-(length:--text-ui) text-(--ink)">gpt-5</div>
              <div className="text-(length:--text-ui) text-(--ink-secondary)">claude</div>
            </div>

            {/* Composer — the panel rung, floating over the chat floor the way
                the real one floats over the transcript. */}
            <div className="px-3 pb-2">
              <div
                className="rounded-lg border border-(--edge) bg-(--panel-surface) px-2 py-1.5"
                style={glassFilter("--panel-backdrop-filter")}
              >
                <span className="text-(length:--text-micro) font-medium tracking-wide text-(--ink-tertiary) uppercase">
                  Chat input
                </span>
                <div className="text-(length:--text-ui) text-(--ink-tertiary)">
                  Describe a change…
                </div>
              </div>
            </div>

            {/* Context bar — the recessed rung. */}
            <div className="border-t border-(--edge) bg-(--recessed-surface) px-3 py-1">
              <span className="text-(length:--text-micro) text-(--ink-tertiary)">
                Context bar · main · 2 changed
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TextSizeRow() {
  const textScale = useClientSettings((settings) => settings.textScale);
  const updateSettings = useUpdateClientSettings();

  const progress = (textScale - MIN_TEXT_SCALE) / (MAX_TEXT_SCALE - MIN_TEXT_SCALE);
  const sliderStyle = {
    "--settings-slider-progress": `${String(progress * 100)}%`,
  } as CSSProperties;

  return (
    <SettingsRow
      title="Text size"
      description="Scales every size in the app together, from the sidebar to the transcript. Spacing and icons stay as they are, so the layout keeps its proportions."
      resetAction={
        textScale === DEFAULT_TEXT_SCALE ? null : (
          <SettingResetButton
            label="text size"
            onClick={() => updateSettings({ textScale: DEFAULT_TEXT_SCALE })}
          />
        )
      }
      control={
        <div className="flex w-full items-center gap-3 sm:w-52">
          <output
            className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-(length:--text-caption) font-medium tabular-nums text-foreground"
            htmlFor="text-scale"
          >
            {Math.round(textScale * 100)}%
          </output>
          <input
            aria-label="Text size"
            className="settings-slider min-w-0 flex-1"
            id="text-scale"
            max={MAX_TEXT_SCALE}
            min={MIN_TEXT_SCALE}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (next >= MIN_TEXT_SCALE && next <= MAX_TEXT_SCALE) {
                updateSettings({ textScale: next });
              }
            }}
            step={TEXT_SCALE_STEP}
            style={sliderStyle}
            type="range"
            value={textScale}
          />
        </div>
      }
    />
  );
}
