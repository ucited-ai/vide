import type { ScopedProjectRef } from "@vide/contracts";

import { AddProjectMenu } from "../AddProjectMenu";
import { MenuTrigger } from "../ui/menu";
import { ProjectPickerMenu } from "./ProjectPickerMenu";
import { useProjectPicker } from "./useProjectPicker";

interface DraftHeroHeadlineProps {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  // Switching from the headline swaps the draft it is standing in for, so the
  // new thread replaces the route rather than stacking a second draft behind it.
  const picker = useProjectPicker({
    activeProjectRef,
    activeProjectTitle,
    replaceRoute: true,
  });
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = picker.entries.length > 0;

  const projectSelector = canChooseProject ? (
    <ProjectPickerMenu picker={picker}>
      <MenuTrigger
        aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
        className="pointer-events-auto inline cursor-pointer border-current border-b border-dotted text-foreground underline-offset-8 transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {picker.activeProjectDisplayName ?? "Choose a project"}
      </MenuTrigger>
    </ProjectPickerMenu>
  ) : (
    <AddProjectMenu>
      <MenuTrigger className="pointer-events-auto inline cursor-pointer border-current border-b border-dotted text-muted-foreground/60 underline-offset-8 transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        {activeProjectTitle ?? "Add a project"}
      </MenuTrigger>
    </AddProjectMenu>
  );

  return (
    <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-(length:--hero-title-size-narrow) text-foreground tracking-tight @sm:text-(length:--chat-hero-title-size) @3xl:text-(length:--chat-hero-title-size-wide)">
      {hasResolvedProject ? (
        <>What should we build in {projectSelector}?</>
      ) : canChooseProject ? (
        <>{projectSelector} to start</>
      ) : (
        <>Add a project to start</>
      )}
    </h1>
  );
}
