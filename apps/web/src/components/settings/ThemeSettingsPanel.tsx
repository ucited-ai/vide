import { DEFAULT_PALETTE, DEFAULT_UNIFIED_SETTINGS, hexToPaletteColor } from "@vide/contracts";
import { CheckIcon } from "lucide-react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "~/lib/utils";
import {
  CHAT_CHANGED_FILES_LAYOUTS,
  CHAT_STREAM_ANIMATIONS,
  CHAT_THINKING_INDICATORS,
  type ChatAppearanceOption,
} from "../chat/chatAppearance";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/**
 * The tints offered per theme, as swatches rather than a colour field.
 *
 * A free colour input is the wrong control here: this value paints the sidebar,
 * the composer and every popup at once, and almost every colour someone could
 * type produces an app that no longer reads as one material. What the setting is
 * really for is choosing how far the surfaces stand off the window background,
 * so the choices are steps along that axis and two neutral casts, all at a
 * lightness that keeps text on them readable.
 *
 * `null` means "leave the stylesheet alone", which is not the same as picking
 * the value the stylesheet happens to hold today — a later change to the ladder
 * should carry to everyone who never chose.
 */
const SURFACE_TINTS: Readonly<
  Record<"light" | "dark", ReadonlyArray<{ readonly label: string; readonly value: string | null }>>
> = {
  dark: [
    { label: "Default", value: null },
    { label: "Flat", value: "#1b1c20" },
    { label: "Raised", value: "#2b2c32" },
    { label: "Elevated", value: "#33343a" },
    { label: "Warm", value: "#262429" },
    { label: "Cool", value: "#20242b" },
  ],
  light: [
    { label: "Default", value: null },
    { label: "Flat", value: "#f7f7f8" },
    { label: "Raised", value: "#ffffff" },
    { label: "Warm", value: "#fdfcfa" },
    { label: "Cool", value: "#fafbfd" },
  ],
};

/** What a swatch shows when it stands for "whatever the stylesheet says". */
const DEFAULT_TINT_PREVIEW = "var(--surface-chrome)";

function SurfaceTintSwatches({
  theme,
  selected,
  onSelect,
}: {
  theme: "light" | "dark";
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SURFACE_TINTS[theme].map((tint) => {
        const isSelected =
          selected === (tint.value === null ? null : hexToPaletteColor(tint.value));
        return (
          <button
            key={tint.label}
            type="button"
            aria-label={tint.label}
            aria-pressed={isSelected}
            title={tint.label}
            onClick={() => onSelect(tint.value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-(--popup-item-radius) border transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              isSelected ? "border-foreground/60" : "border-border hover:border-foreground/30",
            )}
            style={{ background: tint.value ?? DEFAULT_TINT_PREVIEW }}
          >
            {isSelected ? <CheckIcon aria-hidden className="size-3.5 text-foreground/80" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One picker per appearance axis.
 *
 * Three rows that differ only in their list is three chances for them to drift,
 * so they share one — and a new variant shows up in the settings the moment it
 * exists in the registry, without anyone editing this file.
 */
function ChatAppearanceSelect<Id extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<ChatAppearanceOption<Id>>;
  value: Id;
  onChange: (value: Id) => void;
}) {
  const selected = options.find((option) => option.id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (options.some((option) => option.id === next)) {
          onChange(next as Id);
        }
      }}
    >
      <SelectTrigger className="w-full sm:w-40" aria-label={label}>
        <SelectValue>{selected?.label ?? options[0]?.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem hideIndicator key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ChatAppearanceSection() {
  const settings = useClientSettings((value) => value);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsSection title="Chat">
      <SettingsRow
        title="Streaming text"
        description="How an answer's words arrive while it is still being written. Instant shows them the moment they land."
        resetAction={
          settings.chatStreamAnimation !== DEFAULT_UNIFIED_SETTINGS.chatStreamAnimation ? (
            <SettingResetButton
              label="streaming text"
              onClick={() =>
                updateSettings({
                  chatStreamAnimation: DEFAULT_UNIFIED_SETTINGS.chatStreamAnimation,
                })
              }
            />
          ) : null
        }
        control={
          <ChatAppearanceSelect
            label="Streaming text"
            options={CHAT_STREAM_ANIMATIONS}
            value={settings.chatStreamAnimation}
            onChange={(chatStreamAnimation) => updateSettings({ chatStreamAnimation })}
          />
        }
      />

      <SettingsRow
        title="Thinking indicator"
        description="What the transcript shows while a turn is still running."
        resetAction={
          settings.chatThinkingIndicator !== DEFAULT_UNIFIED_SETTINGS.chatThinkingIndicator ? (
            <SettingResetButton
              label="thinking indicator"
              onClick={() =>
                updateSettings({
                  chatThinkingIndicator: DEFAULT_UNIFIED_SETTINGS.chatThinkingIndicator,
                })
              }
            />
          ) : null
        }
        control={
          <ChatAppearanceSelect
            label="Thinking indicator"
            options={CHAT_THINKING_INDICATORS}
            value={settings.chatThinkingIndicator}
            onChange={(chatThinkingIndicator) => updateSettings({ chatThinkingIndicator })}
          />
        }
      />

      <SettingsRow
        title="Changed files"
        description="How the files a turn changed are laid out under the answer. Tree groups them by folder; the rest are flat lists at different densities."
        resetAction={
          settings.chatChangedFilesLayout !== DEFAULT_UNIFIED_SETTINGS.chatChangedFilesLayout ? (
            <SettingResetButton
              label="changed files"
              onClick={() =>
                updateSettings({
                  chatChangedFilesLayout: DEFAULT_UNIFIED_SETTINGS.chatChangedFilesLayout,
                })
              }
            />
          ) : null
        }
        control={
          <ChatAppearanceSelect
            label="Changed files"
            options={CHAT_CHANGED_FILES_LAYOUTS}
            value={settings.chatChangedFilesLayout}
            onChange={(chatChangedFilesLayout) => updateSettings({ chatChangedFilesLayout })}
          />
        }
      />
    </SettingsSection>
  );
}

export function ThemeSettingsPanel() {
  const settings = useClientSettings((value) => value);
  const updateSettings = useUpdateClientSettings();
  const { theme, setTheme, resolvedTheme } = useTheme();

  /*
   * The swatches edit the theme currently on screen, because that is the only
   * one whose result the user can see while choosing. Switching the appearance
   * above therefore switches which half of the setting this row is editing.
   */
  const activeTint = settings.palette[resolvedTheme]["surface-chrome"];
  const tintIsDefault =
    settings.palette.light["surface-chrome"] === null &&
    settings.palette.dark["surface-chrome"] === null;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Theme">
        <SettingsRow
          title="Appearance"
          description="Follow the system setting, or pin the app to light or dark."
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Surface tint"
          description={`How far surfaces stand off the window background. Applies to the sidebar, the composer, menus, dialogs and the environment panel at once, and is stored separately for light and dark — you are editing ${resolvedTheme}.`}
          resetAction={
            tintIsDefault ? null : (
              <SettingResetButton
                label="surface tint"
                onClick={() => updateSettings({ palette: DEFAULT_PALETTE })}
              />
            )
          }
          control={
            <SurfaceTintSwatches
              theme={resolvedTheme}
              selected={activeTint}
              onSelect={(value) =>
                updateSettings({
                  palette: {
                    ...settings.palette,
                    [resolvedTheme]: {
                      ...settings.palette[resolvedTheme],
                      "surface-chrome": value === null ? null : hexToPaletteColor(value),
                    },
                  },
                })
              }
            />
          }
        />
      </SettingsSection>

      <ChatAppearanceSection />
    </SettingsPageContainer>
  );
}
