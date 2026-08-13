"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

const MenuCreateHandle = MenuPrimitive.createHandle;

const Menu = MenuPrimitive.Root;

const MenuPortal = MenuPrimitive.Portal;

function MenuTrigger({ className, children, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger className={className} data-slot="menu-trigger" {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

function MenuPopup({
  children,
  className,
  header,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  collisionAvoidance,
  ...props
}: MenuPrimitive.Popup.Props & {
  /**
   * Full-bleed chrome above the scrolling list — a `PopupSearchField`, a group
   * caption. It sits outside the padded scroll container so its hairline can
   * reach both inner edges of the surface, and so it does not scroll away with
   * the rows it filters.
   */
  header?: React.ReactNode;
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  collisionAvoidance?: MenuPrimitive.Positioner.Props["collisionAvoidance"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        collisionAvoidance={collisionAvoidance}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-[60]"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          // The width floor used to be written `not-[class*='w-']:min-w-32`, to
          // mean "unless the caller sized me". Tailwind compiles that to
          // `:not(*:is(class*='w-'))`, whose inner selector is invalid, so it
          // matched everything *and* outranked any `min-w-*` a caller passed.
          // Plain, so tailwind-merge can hand the decision back to callers.
          // The height cap lives on the surface, not on the scroll container:
          // with a `header` above it the container is no longer the whole popup,
          // so capping the container let the pair overflow the viewport.
          className={cn(
            "dropdown-glass relative flex max-h-(--popup-max-height) min-w-(--popup-min-width) origin-(--transform-origin) flex-col overflow-hidden rounded-(--popup-radius) outline-none focus:outline-none",
            className,
          )}
          data-popup-surface=""
          data-slot="menu-popup"
          {...props}
        >
          {header}
          <div className="min-h-0 w-full flex-1 overflow-y-auto p-(--popup-padding)">
            {children}
          </div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

type MenuRowVariant = "button" | "menu" | "static";

const MENU_ROW_CLASSNAME =
  "flex min-h-(--popup-item-height) w-full items-center gap-(--popup-item-gap) rounded-(--popup-item-radius) px-(--popup-item-padding-inline) py-1 text-(length:--text-ui) text-foreground data-disabled:pointer-events-none disabled:pointer-events-none data-disabled:opacity-64 disabled:opacity-64 [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-(--popup-icon-size) [&>svg:not([class*='text-'])]:text-muted-foreground [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>[data-slot=menu-row-caption]]:ms-auto [&>[data-slot=menu-row-caption]]:max-w-40 [&>[data-slot=menu-row-caption]]:shrink-0 [&>[data-slot=menu-row-caption]]:truncate [&>[data-slot=menu-row-caption]]:text-(length:--text-caption) [&>[data-slot=menu-row-caption]]:text-muted-foreground [&>[data-slot=menu-row-label]]:min-w-0 [&>[data-slot=menu-row-label]]:flex-1";

export function menuRowVariants({ variant = "menu" }: { variant?: MenuRowVariant } = {}) {
  return cn(
    MENU_ROW_CLASSNAME,
    variant === "menu"
      ? "cursor-default select-none outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
      : variant === "button"
        ? "cursor-default select-none text-left outline-none transition-colors hover:bg-accent"
        : undefined,
  );
}

interface MenuRowProps {
  caption?: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  label: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLElement>;
  tone?: "destructive" | "heading" | "muted";
  variant?: Exclude<MenuRowVariant, "menu">;
}

export function MenuRow(props: MenuRowProps) {
  const variant = props.variant ?? "button";
  const Row = variant === "button" ? "button" : "div";
  return (
    <Row
      {...(variant === "button"
        ? { disabled: props.disabled, onClick: props.onClick, type: "button" as const }
        : {})}
      className={cn(
        menuRowVariants({ variant }),
        props.tone === "heading" && "min-h-0 py-1.5 font-medium text-(length:--text-caption)",
      )}
    >
      {props.icon}
      <span
        className={cn(
          props.tone === "destructive" ? "text-pretty text-destructive" : "truncate",
          (props.tone === "heading" || props.tone === "muted") && "text-muted-foreground",
        )}
        data-slot="menu-row-label"
      >
        {props.label}
      </span>
      {props.caption ? <span data-slot="menu-row-caption">{props.caption}</span> : null}
    </Row>
  );
}

function MenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        menuRowVariants({ variant: "menu" }),
        inset && "ps-(--popup-item-inset-padding-inline)",
        "data-[variant=destructive]:text-destructive-foreground data-[variant=destructive]:[&>svg:not([class*='text-'])]:text-current",
        className,
      )}
      data-inset={inset}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "grid min-h-(--popup-item-height) in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default items-center gap-(--popup-item-gap) rounded-(--popup-item-radius) py-1 ps-(--popup-item-padding-inline) text-(length:--text-ui) text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-(--popup-icon-size) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "switch"
          ? "grid-cols-[1fr_auto] gap-4 pe-1.5"
          : "grid-cols-[var(--popup-icon-size)_1fr] pe-(--popup-item-padding-inline)",
        className,
      )}
      data-slot="menu-checkbox-item"
      {...props}
    >
      {variant === "switch" ? (
        <>
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            className="inset-shadow-[0_1px_--theme(--color-black/4%)] inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]"
            keepMounted
          >
            <span className="pointer-events-none block aspect-square h-full in-[[data-slot=menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] origin-left in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_var(--duration-fast)_var(--ease-out),border-radius_var(--duration-fast)_var(--ease-out),scale_var(--duration-fast)_var(--ease-out)_var(--duration-fast),transform-origin_var(--duration-fast)_var(--ease-out)]" />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <>
          <MenuPrimitive.CheckboxItemIndicator className="col-start-1">
            <svg
              fill="none"
              height="24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
            </svg>
          </MenuPrimitive.CheckboxItemIndicator>
          {/* A bare span drops a leading icon onto its own line above the
              label: Tailwind's preflight makes `svg` display:block. Same flex
              row and icon treatment as MenuItem, so a checkbox row with an icon
              reads identically to a plain one. */}
          <span className="col-start-2 flex min-w-0 items-center gap-(--popup-item-gap) [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='text-'])]:text-muted-foreground">
            {children}
          </span>
        </>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

function MenuRadioItem({
  className,
  children,
  hideIndicator: _hideIndicator = false,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  hideIndicator?: boolean;
}) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "flex min-h-(--popup-item-height) in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default items-center rounded-(--popup-item-radius) px-(--popup-item-padding-inline) py-1 text-(length:--text-ui) text-foreground outline-none data-checked:bg-(--wash-selected) data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-(--popup-icon-size) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="menu-radio-item"
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

function MenuGroupLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        "px-(--popup-item-padding-inline) py-(--popup-label-padding-block) font-medium text-(length:--text-caption) text-muted-foreground data-inset:ps-(--popup-item-inset-padding-inline)",
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("mx-(--popup-padding) my-(--popup-padding) h-px bg-border", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

function MenuShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "ms-auto font-medium font-sans text-(length:--text-caption) text-muted-foreground/72 tracking-widest",
        className,
      )}
      data-slot="menu-shortcut"
      {...props}
    />
  );
}

function MenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

function MenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        "flex min-h-(--popup-item-height) cursor-default items-center gap-(--popup-item-gap) rounded-(--popup-item-radius) px-(--popup-item-padding-inline) py-1 text-(length:--text-ui) text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-inset:ps-(--popup-item-inset-padding-inline) data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-(--popup-icon-size) [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none",
        className,
      )}
      data-inset={inset}
      data-slot="menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon className="ms-auto opacity-80" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
}) {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? defaultAlignOffset}
      className={className}
      data-slot="menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export {
  MenuCreateHandle,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu,
  Menu as DropdownMenu,
  MenuPortal,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup,
  MenuPopup as DropdownMenuContent,
  MenuGroup,
  MenuGroup as DropdownMenuGroup,
  MenuItem,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup,
  MenuSubPopup as DropdownMenuSubContent,
};
