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
import { memo, type ReactNode, useCallback, useId, useState } from "react";
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
import { Switch } from "../ui/switch";

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

/** The name of a trait, in the ink every trait row uses for it. */
function TraitsInlineLabel(props: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 font-medium text-(length:--text-caption) text-muted-foreground",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

/**
 * A boolean trait is a switch, not a two-stop slider: it has an off state rather
 * than a low end, and reading it as the bottom of a scale is wrong.
 */
function TraitsSwitchRow(props: {
  label: string;
  isOn: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const switchId = useId();

  return (
    <div className="flex min-h-(--popup-item-height) w-full min-w-0 items-center justify-between gap-(--popup-item-gap) px-(--popup-item-padding-inline)">
      <label htmlFor={switchId}>
        <TraitsInlineLabel className="cursor-default">{props.label}</TraitsInlineLabel>
      </label>
      <Switch
        id={switchId}
        aria-label={props.label}
        checked={props.isOn}
        onCheckedChange={props.onChange}
        className="shrink-0"
      />
    </div>
  );
}

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
 * The traits controls as the model picker's second step, styled as a native
 * menu section rather than a form: a hairline separator marks a new group
 * instead of a wide gap, and every option row shares one height with
 * `ui/menu.tsx`'s `MenuRadioItem`. Nothing here branches on provider — the
 * shape of what renders follows entirely from the descriptors the model
 * declares.
 */
export const TraitsStepContent = memo(function TraitsStepContentImpl(props: TraitsControlProps) {
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

        return (
          <div key={descriptor.id} className="flex w-full min-w-0 flex-col">
            {index > 0 ? <TraitsStepDivider /> : null}
            <div className="px-(--popup-item-padding-inline) pt-1.5 pb-0.5 font-medium text-(length:--text-caption) text-muted-foreground">
              {descriptor.label}
            </div>
            {isLocked ? (
              <div className="px-(--popup-item-padding-inline) pb-1 text-(length:--text-caption) text-muted-foreground/80">
                {ULTRATHINK_BODY_TEXT_HINT}
              </div>
            ) : null}
            {descriptor.options.map((option) => (
              <TraitsStepOptionRow
                key={option.id}
                label={option.label}
                isSelected={option.id === selectedValue}
                isDefault={option.isDefault === true}
                isDisabled={isLocked}
                onSelect={() => handleSelectChange(descriptor, option.id)}
              />
            ))}
          </div>
        );
      })}
      {booleanDescriptors.map((descriptor, index) => (
        <div key={descriptor.id} className="flex w-full min-w-0 flex-col">
          {index > 0 || selectDescriptors.length > 0 ? <TraitsStepDivider /> : null}
          <TraitsSwitchRow
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
  let hasFastMode = false;
  const labels: Array<string> = [];
  for (const descriptor of input.descriptors) {
    if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
      hasFastMode = true;
      continue;
    }
    const label =
      input.ultrathinkPromptControlled && descriptor.id === input.primarySelectDescriptorId
        ? "Ultrathink"
        : descriptor.type === "boolean"
          ? `${descriptor.label} ${descriptor.currentValue === true ? "On" : "Off"}`
          : getProviderOptionCurrentLabel(descriptor);
    if (typeof label === "string" && label.length > 0) {
      labels.push(label);
    }
  }

  // Only fall back to text when fast mode is genuinely the sole trait. Keying
  // off an empty label list alone would also catch descriptors that resolved to
  // no label at all, printing a bogus "Normal" for a model without fast mode.
  if (labels.length === 0 && hasFastMode) {
    return { label: input.fastModeEnabled ? "Fast" : "Normal", showFastModeIcon: false };
  }
  return { label: labels.join(" · "), showFastModeIcon: input.fastModeEnabled };
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
