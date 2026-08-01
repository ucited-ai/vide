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
  DEFAULT_PALETTE,
  DEFAULT_TEXT_SCALE,
  MAX_TEXT_SCALE,
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
 * order they sit in: three surfaces from the floor up, then three weights of
 * text from strongest to faintest.
 */
const SLOT_LABELS: Readonly<Record<PaletteSlot, string>> = {
  "surface-content": "Chat background",
  "surface-recessed": "Inset areas",
  "surface-chrome": "Sidebar & menus",
  ink: "Text",
  "ink-secondary": "Secondary text",
  "ink-tertiary": "Faint text",
};

/*
 * Only the chrome rung is ever painted translucent — see --surface-chrome-alpha
 * in vide-theme.css. Offering opacity on the others would be a slider that
 * moves and changes nothing.
 */
const SLOT_TAKES_OPACITY: PaletteSlot = "surface-chrome";

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

/**
 * The ladder as the stylesheet has it, for both themes at once.
 *
 * Read off a hidden probe rather than copied into a table here: the values are
 * decided in `vide-theme.css`, and a second copy in TypeScript would be wrong
 * the first time anyone tunes one. The probe carries the opposite theme's class,
 * which is the only way to see the other half of the ladder without switching
 * the app to it.
 */
function useLadderColors(): Readonly<
  Record<"light" | "dark", Partial<Record<PaletteSlot, string>>>
> {
  const [colors, setColors] = useState<
    Readonly<Record<"light" | "dark", Partial<Record<PaletteSlot, string>>>>
  >({ light: {}, dark: {} });

  useEffect(() => {
    /* Attached but not painted: custom properties only resolve for an element
       that is actually in the document, and `hidden` costs nothing to lay out. */
    const probe = document.createElement("div");
    probe.hidden = true;
    document.body.append(probe);

    const read = (theme: "light" | "dark") => {
      probe.className = theme === "dark" ? "dark" : "";
      const computed = getComputedStyle(probe);
      const slots: Partial<Record<PaletteSlot, string>> = {};
      for (const slot of PALETTE_SLOTS) {
        const value = computed.getPropertyValue(`--${slot}`).trim();
        if (value !== "") slots[slot] = value;
      }
      return slots;
    };

    setColors({ light: read("light"), dark: read("dark") });
    probe.remove();
  }, []);

  return colors;
}

/** A colour the picker can hold, whatever form the stylesheet wrote it in. */
function toPickerValue(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return color.startsWith("#") ? hexToPaletteColor(color) : color;
}

function SwatchButton({
  slot,
  color,
  presets,
  onChange,
}: {
  readonly slot: PaletteSlot;
  readonly color: string;
  readonly presets: ReadonlyArray<ColorPickerPreset>;
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
                  aria-label={SLOT_LABELS[slot]}
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
        <TooltipPopup side="top">{SLOT_LABELS[slot]}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        side="bottom"
        align="end"
        sideOffset={6}
        className="overflow-hidden rounded-md p-0 [--viewport-inline-padding:0px] [&_[data-slot=popover-viewport]]:p-0"
      >
        <ColorPicker
          value={color}
          onChange={onChange}
          presets={presets}
          showAlpha={slot === SLOT_TAKES_OPACITY}
        />
      </PopoverPopup>
    </Popover>
  );
}

export function ThemeColorsRow() {
  const palette = useClientSettings((settings) => settings.palette);
  const updateSettings = useUpdateClientSettings();
  const { resolvedTheme } = useTheme();
  const ladder = useLadderColors();

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
    push(`${SLOT_LABELS[slot]}, as designed`, toPickerValue(ladder[resolvedTheme][slot]));
    push(`${SLOT_LABELS[slot]} in ${other}`, toPickerValue(ladder[other][slot]));
    if (slot === "surface-chrome") {
      for (const [label, hex] of CHROME_PRESET_HEXES[resolvedTheme]) {
        push(label, hexToPaletteColor(hex));
      }
    }
    return entries;
  };

  const swatch = (slot: PaletteSlot) => (
    <SwatchButton
      key={slot}
      slot={slot}
      /* A rung the user has not chosen shows what the stylesheet is painting. */
      color={active[slot] ?? ladder[resolvedTheme][slot] ?? "transparent"}
      presets={presetsFor(slot)}
      onChange={(value) => write(slot, value)}
    />
  );

  return (
    <SettingsRow
      title="Colours"
      description={`Three surfaces and three weights of text. Everything else — borders, hovers, menus, the focus ring — follows from them. Stored separately for light and dark; you are editing ${resolvedTheme}.`}
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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {swatch("surface-content")}
            {swatch("surface-recessed")}
            {swatch("surface-chrome")}
          </div>
          <span aria-hidden className="h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5">
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
 * A miniature of the app, painted from the same tokens the app is painted from.
 *
 * Both controls in this section change this picture, so there is one of it rather
 * than one per row. It is not a mock: every surface here reads a ladder rung and
 * every line reads a type role, and the popup carries the real `dropdown-glass`
 * class — so it cannot drift from the app, and a colour with opacity shows the
 * same blur here that it will show over the transcript.
 *
 * It deliberately does not override the scale locally. A `--text-scale` set on
 * this element would do nothing: the six roles are substituted at `:root`, so
 * what inherits down here is already a resolved pixel value. The preview shows
 * the live setting instead, which is also the honest thing — what you see is
 * what the app is doing right now.
 *
 * What it earns is the part of the app you cannot see from the settings screen:
 * a sidebar row, a paragraph of an answer, a timestamp and a line of code, at
 * one glance and at the same moment.
 */
export function ThemePreview() {
  return (
    <div
      aria-hidden
      className="mt-1 overflow-hidden rounded-xl border border-border"
      /* Its own stacking context, so the popup's blur samples the preview
         rather than the settings page behind it. */
      style={{ isolation: "isolate" }}
    >
      <div className="flex h-36 bg-(--surface-content)">
        <div className="flex w-28 shrink-0 flex-col gap-1 border-r border-border bg-(--surface-chrome) p-2">
          <span className="text-(length:--text-caption) font-medium text-(--ink-tertiary)">
            Projects
          </span>
          <span className="truncate rounded-md bg-(--wash-selected) px-1.5 py-0.5 text-(length:--text-ui) text-(--ink)">
            vide
          </span>
          <span className="truncate px-1.5 text-(length:--text-ui) text-(--ink-secondary)">
            relay
          </span>
        </div>

        <div className="relative flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          <p className="text-(length:--text-chat) leading-[1.5] text-(--ink)">
            The transcript runs a step larger than the rest, because it is the one thing here that
            is read rather than scanned.
          </p>
          <p className="font-mono text-(length:--code-font-size) text-(--ink-secondary)">
            const scale = 1;
          </p>
          <p className="text-(length:--text-caption) tabular-nums text-(--ink-tertiary)">
            14:32 · 1,204 tokens
          </p>

          {/* The real popup surface, so opacity and blur are shown, not described. */}
          <div className="dropdown-glass absolute right-3 bottom-3 rounded-(--popup-radius) px-2 py-1.5">
            <span className="text-(length:--text-ui) text-(--ink)">gpt-5</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-(--surface-recessed) px-3 py-1.5">
        <span className="text-(length:--text-micro) text-(--ink-tertiary)">main · 2 changed</span>
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
