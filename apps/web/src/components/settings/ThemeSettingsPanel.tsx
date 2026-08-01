import { DEFAULT_UNIFIED_SETTINGS } from "@vide/contracts";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  CHAT_CHANGED_FILES_LAYOUTS,
  CHAT_STREAM_ANIMATIONS,
  CHAT_THINKING_INDICATORS,
  type ChatAppearanceOption,
} from "../chat/chatAppearance";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TextSizeRow, ThemeColorsRow } from "./ThemeAppearanceControls";
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
      </SettingsSection>

      <ChatAppearanceSection />
    </SettingsPageContainer>
  );
}
