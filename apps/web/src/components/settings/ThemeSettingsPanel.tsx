import { DEFAULT_UNIFIED_SETTINGS } from "@vide/contracts";
import { useEffect, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  CHAT_CHANGED_FILES_LAYOUTS,
  CHAT_STREAM_ANIMATIONS,
  CHAT_THINKING_INDICATORS,
  type ChatAppearanceOption,
} from "../chat/chatAppearance";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  ChatIndicatorColorRow,
  GlassBlurRow,
  TextSizeRow,
  ThemeColorsRow,
  ThemePreview,
} from "./ThemeAppearanceControls";
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

const SIDEBAR_VARIANT_OPTIONS = [
  { value: "simple", label: "Simple" },
  { value: "advanced", label: "Advanced" },
] as const;

const AUTO_SETTLE_MIN_DAYS = 1;
const AUTO_SETTLE_MAX_DAYS = 90;
const AUTO_SETTLE_DEFAULT_DAYS = 3;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  // Local draft so the field can be emptied mid-edit; the setting only moves
  // on valid input and snaps back to the persisted value on blur.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      min={AUTO_SETTLE_MIN_DAYS}
      max={AUTO_SETTLE_MAX_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        // Number(), not parseInt: "3.5" must be rejected (not truncated to a
        // committed 3 while the field shows 3.5) — commit only when the
        // persisted value matches the displayed one.
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= AUTO_SETTLE_MIN_DAYS &&
          parsed <= AUTO_SETTLE_MAX_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Days of inactivity before auto-settle"
    />
  );
}

/*
 * Which sidebar the app wears — a presentation choice, so it lives with the
 * theme rather than behind a Beta flag. "Advanced" is the flat, filterable
 * list with rich cards for active work; "Simple" the classic grouped list.
 * The auto-settle rows belong to the detailed variant and follow it here.
 */
function SidebarSection() {
  const sidebarV2Enabled = useClientSettings((settings) => settings.sidebarV2Enabled);
  const sidebarAutoSettleAfterDays = useClientSettings(
    (settings) => settings.sidebarAutoSettleAfterDays,
  );
  const updateSettings = useUpdateClientSettings();
  const variant = sidebarV2Enabled ? "advanced" : "simple";

  return (
    <SettingsSection title="Sidebar">
      <SettingsRow
        title="Layout"
        description="Advanced shows one flat thread list with search, filters and compact lifecycle controls. Simple is the classic grouped project list."
        control={
          <Select
            value={variant}
            onValueChange={(value) => {
              if (value === "simple" || value === "advanced") {
                updateSettings({ sidebarV2Enabled: value === "advanced" });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label="Sidebar layout">
              <SelectValue>
                {SIDEBAR_VARIANT_OPTIONS.find((option) => option.value === variant)?.label ??
                  "Simple"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {SIDEBAR_VARIANT_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {sidebarV2Enabled ? (
        <>
          <SettingsRow
            title="Auto-settle inactive threads"
            description="Threads with no activity for this long settle automatically. Threads on merged or closed PRs always settle."
            control={
              <Switch
                checked={sidebarAutoSettleAfterDays !== null}
                onCheckedChange={(checked) =>
                  updateSettings({
                    sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                  })
                }
                aria-label="Auto-settle inactive threads"
              />
            }
          />
          {sidebarAutoSettleAfterDays !== null ? (
            <SettingsRow
              title="Days of inactivity before auto-settle"
              description="Any new activity un-settles a thread automatically."
              control={
                <AutoSettleDaysInput
                  value={sidebarAutoSettleAfterDays}
                  onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                />
              }
            />
          ) : null}
        </>
      ) : null}
    </SettingsSection>
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

      <ChatIndicatorColorRow />

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
  const { theme, setTheme } = useTheme();

  return (
    <SettingsPageContainer>
      {/*
       * Three rows, in the order they are decided: which theme, how big, what
       * colour. The palette's six swatches sit inside one row rather than
       * becoming six, and opacity lives inside the picker rather than beside
       * it — a colour's transparency is part of the colour, not a setting of
       * its own.
       */}
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

        <TextSizeRow />
        <ThemeColorsRow />
        <GlassBlurRow />

        {/* One picture for the controls above, rather than one each. */}
        <div className="px-3 pb-1 sm:px-4">
          <ThemePreview />
        </div>
      </SettingsSection>

      <SidebarSection />

      <ChatAppearanceSection />
    </SettingsPageContainer>
  );
}
