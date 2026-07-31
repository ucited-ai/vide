import { CheckIcon, FolderIcon, FolderPlusIcon, SearchIcon, XIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AddProjectSubmenu } from "../AddProjectMenu";
import { Input } from "../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubTrigger,
} from "../ui/menu";
import { filterProjectPickerEntries, type ProjectPicker } from "./useProjectPicker";
import { keepPrintableKeysInField } from "~/lib/menuTypeahead";

interface ProjectPickerMenuProps {
  readonly picker: ProjectPicker;
  /** The trigger, as a `MenuTrigger` — same composition as `AddProjectMenu`. */
  readonly children: ReactNode;
}

/**
 * The project switcher: search, pick a project, or start a new one.
 *
 * Shared by the draft headline and the composer context strip, so switching
 * project looks and behaves the same wherever it is reached from. The list is
 * capped and scrolls internally — the popup's height is a function of the
 * design, not of how many projects happen to exist.
 */
export const ProjectPickerMenu = memo(function ProjectPickerMenu({
  picker,
  children,
}: ProjectPickerMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredEntries = useMemo(
    () => filterProjectPickerEntries(picker.entries, query),
    [picker.entries, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    // Base UI moves focus onto the popup as it opens, so the field can only
    // take it back a frame later. Same deferral as AddProjectMenu's URL input.
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      {children}
      {/* Starts at the trigger's left edge and runs right, matching the
          left-aligned context strip it opens from. Centred (the shared default)
          left it straddling the trigger. */}
      <MenuPopup align="start" className="w-(--chat-picker-width)">
        <div className="flex items-center gap-2 border-border/70 border-b px-(--popup-item-padding-inline) pb-1.5 transition-colors focus-within:border-ring">
          <SearchIcon
            aria-hidden="true"
            className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground/55"
          />
          <Input
            ref={searchInputRef}
            unstyled
            size="sm"
            aria-label="Search projects"
            placeholder="Search projects…"
            className="min-w-0 flex-1 [&_input]:bg-transparent [&_input]:px-0 [&_input]:text-(length:--text-ui)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keepPrintableKeysInField}
          />
        </div>
        <div className="max-h-(--chat-picker-list-max-height) overflow-y-auto overscroll-contain pt-1">
          {filteredEntries.length === 0 ? (
            <div className="px-(--popup-item-padding-inline) py-2 text-(length:--text-ui) text-muted-foreground">
              No projects found.
            </div>
          ) : (
            <MenuRadioGroup
              value={picker.activeProjectKey}
              onValueChange={(value) => picker.selectProject(value as string)}
            >
              {filteredEntries.map(({ group }) => (
                <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                  <span className="flex min-w-0 items-center gap-(--popup-item-gap)">
                    <FolderIcon className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
                    {group.projectKey === picker.activeProjectKey ? (
                      <CheckIcon className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground" />
                    ) : null}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          )}
        </div>
        <MenuSeparator />
        <AddProjectSubmenu>
          <MenuSubTrigger>
            <FolderPlusIcon />
            New project
          </MenuSubTrigger>
        </AddProjectSubmenu>
        {/* Every thread — draft or started — is scoped to a project: both the
            draft session and the server thread carry a required projectId. The
            row is shown so the option reads as known-and-unavailable rather than
            missing, and stays disabled until a thread can exist without one. */}
        <MenuItem disabled>
          <XIcon />
          Start tasks without a project
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
