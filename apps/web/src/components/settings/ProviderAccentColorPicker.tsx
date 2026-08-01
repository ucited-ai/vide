"use client";

import { PipetteIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ColorSelector } from "../color-selector";
import { Button } from "../ui/button";
import { ColorPicker } from "../ui/color-picker";
import { formatHex, parseColor } from "../ui/color-picker.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PROVIDER_ACCENT_SWATCHES, normalizeProviderAccentColor } from "../../providerInstances";
import { cn } from "../../lib/utils";

const FALLBACK_ACCENT_COLOR = PROVIDER_ACCENT_SWATCHES[0];

function ProviderCustomColorPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly selected: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const normalized = normalizeProviderAccentColor(props.value) ?? FALLBACK_ACCENT_COLOR;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex size-6 cursor-pointer items-center justify-center rounded-full text-white transition-[scale] active:scale-90",
              "hover:scale-105",
            )}
            style={{
              backgroundColor: normalized,
              ...(props.selected
                ? {
                    boxShadow: `inset 0 0 0 2px var(--card), 0 0 0 2px ${normalized}`,
                  }
                : {}),
            }}
            aria-label={`Choose custom accent color for ${props.displayName}`}
          >
            <PipetteIcon className="size-3 text-foreground/25" aria-hidden />
          </button>
        }
      />
      <PopoverPopup
        side="bottom"
        align="start"
        sideOffset={6}
        className="overflow-hidden rounded-md p-0 [--viewport-inline-padding:0px] [&_[data-slot=popover-viewport]]:p-0"
      >
        {/* An accent is a hue, not a surface: opacity would only ever make an
            instance harder to tell apart, which is the whole job of the colour.
            The picker speaks `rgb(r g b / a%)`; an accent is stored as hex, so
            it is converted at this boundary rather than anywhere deeper. */}
        <ColorPicker
          value={normalized}
          showAlpha={false}
          presets={PROVIDER_ACCENT_SWATCHES.map((swatch) => ({ label: swatch, value: swatch }))}
          onChange={(value) => {
            const picked = parseColor(value);
            if (picked !== undefined) props.onCommit(formatHex({ ...picked, a: 100 }));
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

export function ProviderAccentColorPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly onCommit: (value: string) => void;
  readonly description?: string;
  readonly commitDelayMs?: number;
}) {
  const { commitDelayMs = 0, description, displayName, onCommit, value } = props;
  const [optimisticValue, setOptimisticValue] = useState(() => value ?? "");
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (pendingCommitRef.current !== null) return;
    setOptimisticValue(value ?? "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      const pendingCommit = pendingCommitRef.current;
      if (pendingCommit !== null) {
        onCommitRef.current(pendingCommit);
      }
    };
  }, []);

  const commitAccentColor = useCallback(
    (value: string) => {
      const normalizedValue = normalizeProviderAccentColor(value) ?? "";
      setOptimisticValue(normalizedValue);

      if (commitDelayMs <= 0) {
        pendingCommitRef.current = null;
        if (commitTimeoutRef.current !== null) {
          clearTimeout(commitTimeoutRef.current);
          commitTimeoutRef.current = null;
        }
        onCommit(normalizedValue);
        return;
      }

      pendingCommitRef.current = normalizedValue;
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      commitTimeoutRef.current = setTimeout(() => {
        commitTimeoutRef.current = null;
        const pendingCommit = pendingCommitRef.current;
        pendingCommitRef.current = null;
        if (pendingCommit !== null) {
          onCommitRef.current(pendingCommit);
        }
      }, commitDelayMs);
    },
    [commitDelayMs, onCommit],
  );

  const normalized = normalizeProviderAccentColor(optimisticValue);
  const selectedValue =
    normalized &&
    PROVIDER_ACCENT_SWATCHES.includes(normalized as (typeof PROVIDER_ACCENT_SWATCHES)[number])
      ? normalized
      : "";
  const customSelected = Boolean(normalized && selectedValue === "");

  return (
    <div className="grid gap-2">
      <span className="text-(length:--text-ui) font-medium text-foreground">Accent color</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ProviderCustomColorPicker
          displayName={displayName}
          value={normalized}
          selected={customSelected}
          onCommit={commitAccentColor}
        />
        <ColorSelector
          key={selectedValue}
          colors={[...PROVIDER_ACCENT_SWATCHES]}
          defaultValue={selectedValue}
          size="lg"
          onColorSelect={commitAccentColor}
          className="flex-wrap gap-1.5"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "size-7 shrink-0 text-muted-foreground transition-opacity",
            normalized ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => commitAccentColor("")}
          aria-label={`Clear accent color for ${displayName}`}
          aria-hidden={!normalized}
          tabIndex={normalized ? 0 : -1}
        >
          <XIcon className="size-3.5" aria-hidden />
        </Button>
      </div>
      {description ? (
        <span className="text-(length:--text-caption) text-muted-foreground">{description}</span>
      ) : null}
    </div>
  );
}
