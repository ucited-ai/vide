import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionChoice,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@vide/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@vide/shared/model";
import { memo, useCallback, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { CheckIcon, ChevronDownIcon, ZapIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

type TraitsPersistence =
  | {
      threadRef?: ScopedThreadRef;
      draftId?: DraftId;
      onModelOptionsChange?: never;
    }
  | {
      threadRef?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

const ULTRATHINK_BODY_TEXT_HINT =
  'Your prompt contains "ultrathink" in the text. Remove it to change this option.';

function DefaultBadge() {
  return (
    <Badge
      variant="outline"
      className="inline-flex h-4 w-fit min-w-0 items-center justify-center gap-0 border-border/70 bg-muted/60 px-1.5 py-0 font-semibold text-[10px] text-muted-foreground leading-none sm:h-4"
    >
      Default
    </Badge>
  );
}

function replaceDescriptorCurrentValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  currentValue: string | boolean | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id !== descriptorId
      ? descriptor
      : descriptor.type === "boolean"
        ? {
            ...descriptor,
            ...(typeof currentValue === "boolean" ? { currentValue } : {}),
          }
        : {
            ...descriptor,
            ...(typeof currentValue === "string" ? { currentValue } : {}),
          },
  );
}

/**
 * Descriptor ids whose options are an ordered scale rather than a set of
 * alternatives.
 *
 * A slider means "more of this", which is true of reasoning effort and false of
 * an agent or a model variant — and nothing in the descriptor shape tells the
 * two apart, since both arrive as an ordered list of choices. A provider adding
 * a new scale registers it here; anything unlisted keeps the button row, which
 * is the right control for a choice between named alternatives.
 */
const SCALE_DESCRIPTOR_IDS: ReadonlySet<string> = new Set([
  "effort",
  "reasoning",
  "reasoningEffort",
]);

/**
 * Below this a "scale" is a choice between two things, and a two-stop slider is
 * a worse switch. Those fall back to the button row.
 */
const MIN_SCALE_STOPS = 3;

export interface DescriptorScale {
  /** The ordered stops the slider runs over. */
  readonly stops: ReadonlyArray<ProviderOptionChoice>;
  /**
   * Options the provider fulfils by rewriting the prompt rather than by storing
   * a value — Claude's Ultrathink. They are not positions on the scale, so they
   * cannot be stops on it.
   */
  readonly promptInjected: ReadonlyArray<ProviderOptionChoice>;
}

export function splitDescriptorScale(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
): DescriptorScale {
  const injectedIds = descriptor.promptInjectedValues ?? [];
  return {
    stops: descriptor.options.filter((option) => !injectedIds.includes(option.id)),
    promptInjected: descriptor.options.filter((option) => injectedIds.includes(option.id)),
  };
}

export function isScaleDescriptor(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  scale: DescriptorScale,
): boolean {
  return SCALE_DESCRIPTOR_IDS.has(descriptor.id) && scale.stops.length >= MIN_SCALE_STOPS;
}

function getDescriptorStringValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> | null,
): string | null {
  if (!descriptor) {
    return null;
  }
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : null;
}

function getSelectedTraits(
  provider: ProviderDriverKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean,
) {
  const caps = getProviderModelCapabilities(models, model, provider);
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: modelOptions,
  });
  const selectDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean",
  );
  const primarySelectDescriptor = selectDescriptors[0] ?? null;
  const contextWindowDescriptor =
    selectDescriptors.find((descriptor) => descriptor.id === "contextWindow") ?? null;
  const agentDescriptor = selectDescriptors.find((descriptor) => descriptor.id === "agent") ?? null;
  const fastModeDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const thinkingDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "thinking") ?? null;

  // Prompt-controlled effort (e.g. ultrathink in prompt text)
  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(prompt);

  // Check if "ultrathink" appears in the body text (not just our prefix)
  const ultrathinkInBodyText =
    ultrathinkPromptControlled && isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, ""));
  const effort =
    (ultrathinkPromptControlled
      ? "ultrathink"
      : getDescriptorStringValue(primarySelectDescriptor)) ?? null;
  const thinkingEnabled =
    typeof thinkingDescriptor?.currentValue === "boolean" ? thinkingDescriptor.currentValue : null;
  const fastModeEnabled =
    typeof fastModeDescriptor?.currentValue === "boolean" ? fastModeDescriptor.currentValue : false;
  const contextWindow = getDescriptorStringValue(contextWindowDescriptor);
  const selectedAgent = getDescriptorStringValue(agentDescriptor);
  const selectedAgentLabel = agentDescriptor
    ? getProviderOptionCurrentLabel(agentDescriptor)
    : null;

  return {
    caps,
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    contextWindowDescriptor,
    agentDescriptor,
    fastModeDescriptor,
    thinkingDescriptor,
    effort,
    thinkingEnabled,
    fastModeEnabled,
    contextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    selectedAgent,
    selectedAgentLabel,
  };
}

function getTraitsSectionVisibility(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
}) {
  const selected = getSelectedTraits(
    input.provider,
    input.models,
    input.model,
    input.prompt,
    input.modelOptions,
    input.allowPromptInjectedEffort ?? true,
  );

  const showEffort = selected.primarySelectDescriptor !== null;
  const showThinking = selected.thinkingDescriptor !== null;
  const showFastMode = selected.fastModeDescriptor !== null;
  const showContextWindow = selected.contextWindowDescriptor !== null;
  const showAgent = selected.agentDescriptor !== null;

  return {
    ...selected,
    showEffort,
    showThinking,
    showFastMode,
    showContextWindow,
    showAgent,
    hasAnyControls: showEffort || showThinking || showFastMode || showContextWindow || showAgent,
  };
}

export function shouldRenderTraitsControls(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
}): boolean {
  return getTraitsSectionVisibility(input).hasAnyControls;
}

export interface TraitsMenuContentProps {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
}

export type TraitsControlProps = TraitsMenuContentProps & TraitsPersistence;

/**
 * Everything a traits control *does*, with nothing about how it looks: which
 * descriptors are visible, what each one currently reads, and what choosing a
 * value writes back.
 *
 * Split out from the menu so the same behaviour can render more than one way.
 * The menu variant needs a Base UI `Menu` ancestor, and nesting one inside the
 * model picker's popover made selecting an effort tear that popover down — so
 * the picker renders its own step instead (see {@link TraitsStepContent}),
 * plain rows with no Base UI menu underneath them.
 */
export function useTraitsControl({
  provider,
  instanceId,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  ...persistence
}: TraitsControlProps) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const updateModelOptions = useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      if ("onModelOptionsChange" in persistence) {
        persistence.onModelOptionsChange(nextOptions);
        return;
      }
      const threadTarget = persistence.threadRef ?? persistence.draftId;
      if (!threadTarget) {
        return;
      }
      setProviderModelOptions(threadTarget, provider, nextOptions, {
        ...(instanceId ? { instanceId } : {}),
        model,
        persistSticky: true,
      });
    },
    [instanceId, model, persistence, provider, setProviderModelOptions],
  );
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls,
  } = getTraitsSectionVisibility({
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
  });
  const updateDescriptors = (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
    updateModelOptions(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
  };

  /**
   * The prompt owns this descriptor for as long as "ultrathink" sits in the
   * body text, so the control shows the state but refuses to write it.
   */
  const isSelectLocked = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  ): boolean => ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id;

  const getSelectValue = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  ): string =>
    ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id
      ? "ultrathink"
      : (getDescriptorStringValue(descriptor) ?? "");

  const handleSelectChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    value: string,
  ) => {
    if (!value) return;
    if (descriptor.promptInjectedValues?.includes(value)) {
      const nextPrompt =
        prompt.trim().length === 0
          ? ULTRATHINK_PROMPT_PREFIX
          : applyClaudePromptEffortPrefix(prompt, "ultrathink");
      onPromptChange(nextPrompt);
      return;
    }
    if (ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id) return;
    if (ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id) {
      const stripped = prompt.replace(/^Ultrathink:\s*/i, "");
      onPromptChange(stripped);
    }
    updateDescriptors(replaceDescriptorCurrentValue(descriptors, descriptor.id, value));
  };

  const handleBooleanChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "boolean" }>,
    enabled: boolean,
  ) => {
    updateDescriptors(replaceDescriptorCurrentValue(descriptors, descriptor.id, enabled));
  };

  return {
    hasAnyControls,
    selectDescriptors,
    booleanDescriptors,
    getSelectValue,
    isSelectLocked,
    handleSelectChange,
    handleBooleanChange,
  };
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl(props: TraitsControlProps) {
  const {
    hasAnyControls,
    selectDescriptors,
    booleanDescriptors,
    getSelectValue,
    isSelectLocked,
    handleSelectChange,
    handleBooleanChange,
  } = useTraitsControl(props);

  if (!hasAnyControls) {
    return null;
  }

  return (
    <>
      {selectDescriptors.map((descriptor, index) => {
        const isLocked = isSelectLocked(descriptor);
        const selectedValue = getSelectValue(descriptor);

        return (
          <div key={descriptor.id}>
            {index > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                {descriptor.label}
              </div>
              {isLocked ? (
                <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                  {ULTRATHINK_BODY_TEXT_HINT}
                </div>
              ) : null}
              <MenuRadioGroup
                value={selectedValue}
                onValueChange={(value) => handleSelectChange(descriptor, value)}
              >
                {descriptor.options.map((option) => (
                  <MenuRadioItem
                    key={option.id}
                    value={option.id}
                    hideIndicator
                    disabled={isLocked}
                  >
                    <span className="flex w-full min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {option.label}
                        {option.isDefault ? (
                          <>
                            {" "}
                            <DefaultBadge />
                          </>
                        ) : null}
                      </span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        );
      })}
      {booleanDescriptors.map((descriptor, index) => {
        const selectedValue = descriptor.currentValue === true ? "on" : "off";

        return (
          <div key={descriptor.id}>
            {index > 0 || selectDescriptors.length > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                {descriptor.label}
              </div>
              <MenuRadioGroup
                value={selectedValue}
                onValueChange={(value) => handleBooleanChange(descriptor, value === "on")}
              >
                {(["on", "off"] as const).map((value) => (
                  <MenuRadioItem key={value} value={value} hideIndicator>
                    <span className="flex w-full min-w-0 items-center justify-between gap-3">
                      <span>{value === "on" ? "On" : "Off"}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        );
      })}
    </>
  );
});

/** A hairline break between traits groups, standing in for a Base UI menu
 * separator: this step renders inside a Popover rather than a Menu, so there
 * is no Menu.Root for a real MenuSeparator to anchor to. */
function TraitsStepDivider() {
  return (
    <div aria-hidden="true" className="mx-(--popup-item-padding-inline) my-1 h-px bg-(--edge)" />
  );
}

/**
 * One descriptor's options as a plain vertical list, full width, one
 * consistent row height — the same shape `ui/menu.tsx` renders a
 * `MenuRadioItem` at, so the two surfaces read as one popup.
 *
 * The step has an entire popup's worth of room, so an ordered scale doesn't
 * need a slider to read as ordered — the options are already in order top to
 * bottom. That also covers Ultrathink for free: a prompt-injected option is
 * just another row here, not a pill carved out separately.
 */
function TraitsStepOptionRow(props: {
  label: string;
  isSelected: boolean;
  isDefault: boolean;
  isDisabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.isDisabled}
      // The popup's keyboard navigation lives in its search field. Keeping the
      // press from moving focus leaves the model list arrow-navigable while
      // the trait is being changed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onSelect}
      className={cn(
        "flex h-(--popup-item-height) w-full min-w-0 cursor-default items-center gap-(--popup-item-gap) rounded-sm px-(--popup-item-padding-inline) text-left text-(length:--text-ui) outline-none transition-colors",
        props.isSelected
          ? "bg-(--wash-selected) text-foreground"
          : "text-muted-foreground hover:bg-(--wash-hover) hover:text-foreground",
        props.isDisabled ? "pointer-events-none opacity-64" : "",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {props.label}
        {props.isDefault ? (
          <>
            {" "}
            <DefaultBadge />
          </>
        ) : null}
      </span>
      <CheckIcon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", props.isSelected ? "opacity-100" : "opacity-0")}
      />
    </button>
  );
}

/**
 * An ordered scale as a stepped track: the name of the level above it, the
 * stops beneath it, and the reached ones filled in.
 *
 * A scale is not a set of choices — "medium" only means anything relative to
 * "low" and "high" — and a vertical list of radio rows says nothing about that
 * order beyond the accident of its own arrangement. The track states it: how far
 * along you are is a position, and each stop is lighter than the one before it,
 * so "more" reads as "further and brighter" without a second colour entering
 * the app.
 *
 * The stop count comes from the descriptor, so a model with four effort levels
 * gets four stops and one with six gets six, with no per-model branching.
 */
function TraitsScaleTrack(props: {
  label: string;
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean | undefined }>;
  selectedId: string | null;
  isDisabled: boolean;
  onSelect: (optionId: string) => void;
}) {
  const selectedIndex = Math.max(
    0,
    props.options.findIndex((option) => option.id === props.selectedId),
  );
  const lastIndex = Math.max(1, props.options.length - 1);
  const selected = props.options[selectedIndex];

  const selectAt = (index: number, group: HTMLElement) => {
    const clamped = Math.min(props.options.length - 1, Math.max(0, index));
    const next = props.options[clamped];
    if (!next || next.id === props.selectedId) return;
    props.onSelect(next.id);
    // Roving tabindex: the stop that just became current is the one that has to
    // be focusable, or the next arrow press has nowhere to come from.
    group.querySelectorAll("button")[clamped]?.focus();
  };

  /*
   * Which stop the pointer is over. The stops are spread edge to edge and are
   * one stop wide, so their centres run from half a stop in to half a stop from
   * the end — the usable travel is the track minus one stop.
   */
  const stopIndexAtX = (clientX: number, group: HTMLElement) => {
    const rect = group.getBoundingClientRect();
    const travel = Math.max(1, rect.width - rect.height);
    return Math.round(((clientX - rect.left - rect.height / 2) / travel) * lastIndex);
  };

  return (
    <div className="px-(--popup-item-padding-inline) pt-1.5 pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-(length:--text-caption) text-muted-foreground">
          {props.label}
        </span>
        <span className="truncate text-(length:--text-ui) text-foreground">
          {selected?.label ?? "—"}
          {selected?.isDefault === true ? (
            <>
              {" "}
              <DefaultBadge />
            </>
          ) : null}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={props.label}
        aria-disabled={props.isDisabled || undefined}
        /*
         * Dragging, not only clicking. A track you can merely tap is a row of
         * radio buttons wearing a track's clothes; holding it and feeling the
         * levels go by is the whole reason for the shape. The group takes the
         * pointer rather than the stops, so the drag survives leaving one.
         */
        onPointerDown={(event) => {
          if (props.isDisabled || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          selectAt(stopIndexAtX(event.clientX, event.currentTarget), event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (props.isDisabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          selectAt(stopIndexAtX(event.clientX, event.currentTarget), event.currentTarget);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onKeyDown={(event) => {
          if (props.isDisabled) return;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            selectAt(selectedIndex + 1, event.currentTarget);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            selectAt(selectedIndex - 1, event.currentTarget);
          }
        }}
        className={cn(
          "group/track relative mt-2.5 flex h-4 touch-none items-center justify-between",
          props.isDisabled ? "" : "cursor-pointer",
          props.isDisabled ? "pointer-events-none opacity-64" : "",
        )}
      >
        <span aria-hidden className="absolute inset-x-1.5 h-px bg-border" />
        <span
          aria-hidden
          className="absolute left-1.5 h-px bg-foreground/60 transition-[width]"
          style={{ width: `calc((100% - 0.75rem) * ${selectedIndex / lastIndex})` }}
        />
        {props.options.map((option, index) => {
          const reached = index <= selectedIndex;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={index === selectedIndex}
              aria-label={option.label}
              title={option.label}
              tabIndex={index === selectedIndex ? 0 : -1}
              // The group above owns the pointer so a press can become a drag.
              // These stay real buttons for focus, keyboard and screen readers,
              // and unlike the option rows they do take focus: arrow keys are
              // the point of a track and never arrive while the popup's search
              // field still holds it.
              className="relative z-10 flex size-4 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "rounded-full transition-all",
                  // The whole track answers to hovering any part of it: the
                  // stops swell slightly, which is what tells you it is a thing
                  // you may grab rather than a row of dots.
                  index === selectedIndex
                    ? "size-2.5 bg-foreground group-hover/track:size-3"
                    : reached
                      ? "size-1.5 bg-foreground/55 group-hover/track:size-2"
                      : "size-1.5 bg-muted-foreground/35 group-hover/track:size-2 group-hover/track:bg-muted-foreground/55",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A boolean as one row with its two states side by side, rather than a switch
 * stacked under everything else. Beside the scale above it this keeps the whole
 * step two lines tall instead of a column of unrelated controls.
 */
function TraitsSegmentedRow(props: {
  label: string;
  isOn: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-(--popup-item-padding-inline) py-1.5">
      <span className="min-w-0 truncate text-(length:--text-ui) text-foreground">
        {props.label}
      </span>
      <div
        role="radiogroup"
        aria-label={props.label}
        className="flex shrink-0 items-center gap-0.5 rounded-(--popup-item-radius) bg-(--wash-hover) p-0.5"
      >
        {[true, false].map((value) => (
          <button
            key={value ? "on" : "off"}
            type="button"
            role="radio"
            aria-checked={props.isOn === value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onChange(value)}
            className={cn(
              "rounded-[calc(var(--popup-item-radius)-2px)] px-2 py-0.5 text-(length:--text-caption) transition-colors",
              props.isOn === value
                ? "bg-(--surface-raised-1) text-foreground shadow-[0_1px_2px_rgb(0_0_0/12%)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value ? "On" : "Off"}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The traits controls as the model picker's second step, styled as a native
 * menu section rather than a form: a hairline separator marks a new group
 * instead of a wide gap, and every option row shares one height with
 * `ui/menu.tsx`'s `MenuRadioItem`. Nothing here branches on provider — the
 * shape of what renders follows entirely from the descriptors the model
 * declares.
 */
export const TraitsStepContent = memo(function TraitsStepContentImpl(
  props: TraitsControlProps & { onAfterSelect?: (() => void) | undefined },
) {
  const {
    hasAnyControls,
    selectDescriptors,
    booleanDescriptors,
    getSelectValue,
    isSelectLocked,
    handleSelectChange,
    handleBooleanChange,
  } = useTraitsControl(props);

  if (!hasAnyControls) {
    return null;
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      {selectDescriptors.map((descriptor, index) => {
        const isLocked = isSelectLocked(descriptor);
        const selectedValue = getSelectValue(descriptor);
        /*
         * An ordered scale gets the track; anything else stays a list. Picking a
         * level on the track is the last thing anyone does in this step, so it
         * also closes the popup — the alternative is a menu that stays open
         * after its only remaining question has been answered.
         */
        const scale = splitDescriptorScale(descriptor);
        const showTrack = isScaleDescriptor(descriptor, scale);

        return (
          <div key={descriptor.id} className="flex w-full min-w-0 flex-col">
            {index > 0 ? <TraitsStepDivider /> : null}
            {showTrack ? (
              <>
                <TraitsScaleTrack
                  label={descriptor.label}
                  options={scale.stops}
                  selectedId={selectedValue}
                  isDisabled={isLocked}
                  onSelect={(optionId) => {
                    handleSelectChange(descriptor, optionId);
                    props.onAfterSelect?.();
                  }}
                />
                {scale.promptInjected.map((option) => (
                  <TraitsStepOptionRow
                    key={option.id}
                    label={option.label}
                    isSelected={option.id === selectedValue}
                    isDefault={option.isDefault === true}
                    isDisabled={isLocked}
                    onSelect={() => {
                      handleSelectChange(descriptor, option.id);
                      props.onAfterSelect?.();
                    }}
                  />
                ))}
              </>
            ) : (
              <>
                <div className="px-(--popup-item-padding-inline) pt-1.5 pb-0.5 font-medium text-(length:--text-caption) text-muted-foreground">
                  {descriptor.label}
                </div>
                {descriptor.options.map((option) => (
                  <TraitsStepOptionRow
                    key={option.id}
                    label={option.label}
                    isSelected={option.id === selectedValue}
                    isDefault={option.isDefault === true}
                    isDisabled={isLocked}
                    onSelect={() => {
                      handleSelectChange(descriptor, option.id);
                      props.onAfterSelect?.();
                    }}
                  />
                ))}
              </>
            )}
            {isLocked ? (
              <div className="px-(--popup-item-padding-inline) pb-1 text-(length:--text-caption) text-muted-foreground/80">
                {ULTRATHINK_BODY_TEXT_HINT}
              </div>
            ) : null}
          </div>
        );
      })}
      {booleanDescriptors.map((descriptor, index) => (
        <div key={descriptor.id} className="flex w-full min-w-0 flex-col">
          {index > 0 || selectDescriptors.length > 0 ? <TraitsStepDivider /> : null}
          <TraitsSegmentedRow
            label={descriptor.label}
            isOn={descriptor.currentValue === true}
            onChange={(enabled) => handleBooleanChange(descriptor, enabled)}
          />
        </div>
      ))}
    </div>
  );
});

/**
 * Build the traits trigger's text label plus whether the fast-mode bolt should
 * render. Fast mode is a lightning bolt when on and nothing at all when off —
 * "Normal" is the near-universal case and isn't worth the horizontal space. The
 * one exception is when fast mode is the only trait, where a bare bolt (or bare
 * chevron) would leave the trigger unreadable.
 */
export function buildTraitsTriggerDisplay(input: {
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  primarySelectDescriptorId: string | null;
  ultrathinkPromptControlled: boolean;
  fastModeEnabled: boolean;
}): { label: string; showFastModeIcon: boolean } {
  /*
   * The trigger says the model and its effort, nothing else.
   *
   * It used to join every descriptor with a separator, so a Claude model read
   * "High · 1M" and, in the width the trigger actually gets, "High · ..." — an
   * ellipsis standing in for information the user cannot see anyway. Context
   * window, service tier and the boolean traits all live one click away in the
   * picker's second step, which is where they belong; the trigger is a label,
   * not a summary.
   */
  const hasFastMode = input.descriptors.some(
    (descriptor) => descriptor.id === "fastMode" && descriptor.type === "boolean",
  );
  const primary =
    input.primarySelectDescriptorId === null
      ? undefined
      : input.descriptors.find((descriptor) => descriptor.id === input.primarySelectDescriptorId);

  const label = input.ultrathinkPromptControlled
    ? "Ultrathink"
    : primary === undefined
      ? ""
      : (getProviderOptionCurrentLabel(primary) ?? "");

  // Fast mode is a label only when it is the model's sole trait; otherwise it
  // stays an icon, and a model with no effort scale shows no qualifier at all.
  if (label.length === 0 && hasFastMode) {
    return { label: input.fastModeEnabled ? "Fast" : "Normal", showFastModeIcon: false };
  }
  return { label, showFastModeIcon: input.fastModeEnabled };
}

/**
 * The traits label on its own, for callers that render the model and its
 * qualifier as one control.
 *
 * Returns null when the model exposes no options at all — effort is provider
 * driven, so a model with no descriptors must degrade to a bare model name
 * rather than printing an empty qualifier.
 */
export function getTraitsTriggerLabel(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
}): string | null {
  const visibility = getTraitsSectionVisibility(input);
  if (!visibility.hasAnyControls) {
    return null;
  }
  const { label } = buildTraitsTriggerDisplay({
    descriptors: visibility.descriptors,
    primarySelectDescriptorId: visibility.primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled: visibility.ultrathinkPromptControlled,
    fastModeEnabled: visibility.fastModeEnabled,
  });
  return label.length > 0 ? label : null;
}

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  instanceId,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  triggerVariant,
  triggerClassName,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { descriptors, primarySelectDescriptor, ultrathinkPromptControlled, fastModeEnabled } =
    getTraitsSectionVisibility({
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
    });
  if (
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
    })
  ) {
    return null;
  }

  const { label: triggerLabel, showFastModeIcon } = buildTraitsTriggerDisplay({
    descriptors,
    primarySelectDescriptorId: primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled,
    fastModeEnabled,
  });
  const fastModeIcon = showFastModeIcon ? (
    <>
      <ZapIcon aria-hidden="true" className="size-3 shrink-0 text-foreground/80 opacity-100" />
      <span className="sr-only">Fast mode on</span>
    </>
  ) : null;

  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={triggerVariant ?? "ghost"}
            className={cn(
              isCodexStyle
                ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0"
                : "shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3",
              triggerClassName,
            )}
          />
        }
      >
        {isCodexStyle ? (
          <span className="flex min-w-0 w-full items-center gap-1.5 overflow-hidden">
            {fastModeIcon}
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </span>
        ) : (
          <>
            {fastModeIcon}
            <span>{triggerLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <TraitsMenuContent
          provider={provider}
          {...(instanceId ? { instanceId } : {})}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});
