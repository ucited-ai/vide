"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { SearchIcon } from "lucide-react";
import type * as React from "react";

import { keepPrintableKeysInField } from "~/lib/menuTypeahead";
import { cn } from "~/lib/utils";

/*
 * The one search field that goes inside a popup.
 *
 * Four surfaces built their own before this existed — the project picker, the
 * branch picker, the environment column and the command palette — and all four
 * boxed it: a bordered input with a heavy rule under it, which makes a menu look
 * like it has a form stuck inside it. Codex's is chrome, not a control: a
 * magnifier, the placeholder, a hairline beneath, sitting on the popup's own
 * surface. Everything below is geometry from vide-theme.css, so the field can
 * never drift from the rows it filters.
 *
 * `keepPrintableKeysInField` is wired in here rather than left to callers,
 * because this is precisely the class of field that Base UI's menu typeahead
 * eats: every printable key is preventDefaulted by the popup, the field looks
 * like a broken keyboard, and nothing throws or logs. Owning the handler means a
 * new picker cannot reintroduce that bug by forgetting it.
 */

const POPUP_SEARCH_FIELD_CLASS =
  "flex h-(--popup-search-height) shrink-0 items-center gap-(--popup-item-gap) px-(--popup-search-padding-inline)";

const POPUP_SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 bg-transparent text-(length:--text-ui) text-foreground outline-none placeholder:text-muted-foreground/72";

interface PopupSearchFieldProps extends useRender.ComponentProps<"input"> {
  /** Replaces the magnifier. The command palette swaps in a back arrow. */
  icon?: React.ReactNode;
  /** The hairline under the field. Off only when something else divides it. */
  divider?: boolean;
  /** Classes for the row, not the input. `className` still reaches the input. */
  fieldClassName?: string;
}

function PopupSearchField({
  className,
  divider = true,
  fieldClassName,
  icon,
  onKeyDown,
  render,
  ...props
}: PopupSearchFieldProps) {
  const defaultProps = {
    autoComplete: "off",
    className: cn(POPUP_SEARCH_INPUT_CLASS, className),
    "data-slot": "popup-search-input",
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      keepPrintableKeysInField(event);
      onKeyDown?.(event);
    },
    spellCheck: false,
  };

  const inputElement = useRender({
    defaultTagName: "input",
    props: mergeProps<"input">(defaultProps, props),
    render,
  });

  return (
    <div
      className={cn(POPUP_SEARCH_FIELD_CLASS, divider && "border-border border-b", fieldClassName)}
      data-slot="popup-search-field"
    >
      <span
        className="pointer-events-none flex shrink-0 items-center text-muted-foreground [&_button]:pointer-events-auto [&_button]:cursor-pointer [&_svg]:size-(--popup-icon-size)"
        data-slot="popup-search-icon"
      >
        {icon ?? <SearchIcon aria-hidden="true" />}
      </span>
      {inputElement}
    </div>
  );
}

export { PopupSearchField, type PopupSearchFieldProps };
