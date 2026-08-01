import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@vide/contracts";
import { memo, useEffect, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { ModelPickerContent } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { QualifiedLabel } from "./QualifiedLabel";
import {
  ModelEsque,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils";
import type { TraitsControlProps } from "./TraitsPicker";
import type { ProviderInstanceEntry } from "../../providerInstances";

/**
 * Collision handling for a popup whose direction is a decision, not a
 * preference.
 *
 * Base UI's default is to flip to the opposite side when the preferred one runs
 * short. For a control docked to the bottom of the window that is exactly wrong:
 * the same picker opened above the trigger on a tall window and below it on a
 * short one, which is the restlessness the composer's popups were read as. Here
 * the side is pinned and only the alignment is allowed to move, so a popup with
 * too little room scrolls its own viewport — it is already capped at
 * `--available-height` — instead of jumping to the other side of the trigger.
 */
export const PINNED_POPUP_COLLISION_AVOIDANCE = {
  side: "none",
  align: "shift",
  fallbackAxisSide: "none",
} as const;

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  /**
   * The instance currently selected in the composer. Drives the trigger
   * icon, label and the default-highlighted combobox row.
   */
  activeInstanceId: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /** Configured provider instances, used to resolve each model's display name. */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  /**
   * What grades the selected model — a reasoning effort, a thinking level.
   * Rendered muted after the name so the two read as one label. Provider
   * driven, so it is absent for models that expose no options.
   */
  qualifier?: string | null;
  /**
   * Drives the popup's second step — the picked model's options — via
   * `useTraitsControl`. Omitted by callers with no traits target (the
   * settings pages' pickers), which keeps the popup a single step: picking a
   * model there still closes it immediately, same as before this became a
   * two-step control.
   */
  traitsInput?: TraitsControlProps;
  /**
   * "top" makes this a drop-up, which is what a composer-anchored picker wants.
   * Naming a side also pins it: see {@link PINNED_POPUP_COLLISION_AVOIDANCE}.
   */
  popupSide?: "top" | "bottom";
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  triggerAriaLabel?: string;
  onOpenChange?: (open: boolean) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;

  // Resolve the active instance entry by exact routing key. The composer
  // resolves fallbacks before rendering this component; if the selected
  // instance disappears, do not infer a replacement from its driver kind.
  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null
    );
  }, [props.activeInstanceId, props.instanceEntries]);

  const activeInstanceId = props.activeInstanceId;
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? [];
  // If the current slug belongs to a different instance (for example after
  // a provider switch or disable), prefer the active instance's first
  // option so the trigger icon and label stay in sync instead of showing
  // a stale foreign slug.
  const selectedModel =
    selectedInstanceOptions.find((option) => option.slug === props.model) ??
    selectedInstanceOptions[0];
  const triggerTitle = selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model;
  const triggerLabel = selectedModel ? getTriggerDisplayModelLabel(selectedModel) : props.model;
  const duplicateDriverCount = props.instanceEntries.filter(
    (entry) => activeEntry !== null && entry.driverKind === activeEntry.driverKind,
  ).length;
  const showInstanceBadge = Boolean(activeEntry?.accentColor) || duplicateDriverCount > 1;

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const { documentElement, body } = document;
    const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    documentElement.style.overscrollBehavior = "contain";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const shouldAllowOverlayScroll = (target: EventTarget | null) => {
      return target instanceof Element && target.closest("[data-model-picker-content]");
    };
    const preventBackgroundWheel = (event: WheelEvent) => {
      if (shouldAllowOverlayScroll(event.target)) {
        return;
      }
      event.preventDefault();
    };
    const preventBackgroundTouchMove = (event: TouchEvent) => {
      if (shouldAllowOverlayScroll(event.target)) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener("wheel", preventBackgroundWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", preventBackgroundTouchMove, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", preventBackgroundWheel, { capture: true });
      document.removeEventListener("touchmove", preventBackgroundTouchMove, { capture: true });
      documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    };
  }, [isMenuOpen]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    // Closing is now ModelPickerContent's call, not this one: a model with
    // options advances to the popup's second step instead of closing, so it
    // can be adjusted right after picking. It closes itself via
    // `onRequestClose` for a model with nothing to configure.
  };

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            aria-label={props.triggerAriaLabel}
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-between whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {activeEntry ? (
            <ProviderInstanceIcon
              driverKind={activeEntry.driverKind}
              displayName={activeEntry.displayName}
              accentColor={activeEntry.accentColor}
              showBadge={showInstanceBadge}
              className={showInstanceBadge ? "size-5" : "size-4"}
              iconClassName={cn("size-4", props.activeProviderIconClassName)}
              indicatorBackground="var(--input)"
              badgeClassName={cn(
                "right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3",
                "px-0.5 text-[7px]",
              )}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 flex-1 overflow-hidden truncate" />}>
              <QualifiedLabel name={triggerTitle} trail={props.qualifier} separator=" · " />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {props.qualifier ? `${triggerLabel} · ${props.qualifier}` : triggerLabel}
            </TooltipPopup>
          </Tooltip>
        </span>
        <span aria-hidden="true" className="flex items-center">
          <ChevronDownIcon aria-hidden="true" className="!ms-0 !-me-1 size-3 shrink-0 opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side={props.popupSide ?? "bottom"}
        {...(props.popupSide ? { collisionAvoidance: PINNED_POPUP_COLLISION_AVOIDANCE } : {})}
        /*
         * The popup carries the one pane of glass, like every other popover;
         * the panel inside owns layout only. This used to be inverted — glass
         * on the panel, `bg-transparent` on the popup — but the neutralising
         * utilities are layered and `.dropdown-glass` is not, so the popup's
         * background survived and the picker wore two panes of glass stacked:
         * visibly brighter and more opaque than every sibling popup at the
         * same chrome alpha.
         */
        className="p-0 [--viewport-inline-padding:0]"
        viewportClassName="rounded-lg !overflow-hidden p-0"
      >
        <ModelPickerContent
          {...(props.traitsInput ? { traitsInput: props.traitsInput } : {})}
          activeInstanceId={activeInstanceId}
          model={props.model}
          lockedProvider={props.lockedProvider}
          lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
          instanceEntries={props.instanceEntries}
          {...(props.keybindings ? { keybindings: props.keybindings } : {})}
          modelOptionsByInstance={props.modelOptionsByInstance}
          terminalOpen={props.terminalOpen ?? false}
          onRequestClose={() => setIsMenuOpen(false)}
          {...(props.getModelDisabledReason
            ? { getModelDisabledReason: props.getModelDisabledReason }
            : {})}
          onInstanceModelChange={handleInstanceModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});
