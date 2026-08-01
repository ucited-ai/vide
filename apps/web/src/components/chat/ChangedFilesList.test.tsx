import { TurnId } from "@vide/contracts";
import { ChatChangedFilesLayout } from "@vide/contracts/settings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChangedFilesList } from "./ChangedFilesList";
import { ChangedFilesCard } from "./ChangedFilesTree";

const FILES = [
  { path: "apps/web/src/App.tsx", kind: "modified", additions: 12, deletions: 3 },
  { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
];

function renderCard(layout: ChatChangedFilesLayout): string {
  return renderToStaticMarkup(
    <ChangedFilesCard
      turnId={TurnId.make("turn-1")}
      files={FILES}
      expanded
      showCompactPreview={false}
      allDirectoriesExpanded
      layout={layout}
      resolvedTheme="light"
      onExpandedChange={() => {}}
      onToggleAllDirectories={() => {}}
      onOpenTurnDiff={() => {}}
    />,
  );
}

function renderList(layout: Exclude<ChatChangedFilesLayout, "tree">): string {
  return renderToStaticMarkup(
    <ChangedFilesList
      turnId={TurnId.make("turn-1")}
      files={FILES}
      layout={layout}
      resolvedTheme="light"
      onOpenTurnDiff={() => {}}
    />,
  );
}

const FLAT_LAYOUTS = ChatChangedFilesLayout.literals.filter((layout) => layout !== "tree");

describe("ChangedFilesCard layouts", () => {
  it.each([...FLAT_LAYOUTS])("names every changed file in the %s layout", (layout) => {
    const markup = renderCard(layout);

    expect(markup).toContain(`data-changed-files-layout="${layout}"`);
    expect(markup).toContain("App.tsx");
    expect(markup).toContain("README.md");
    expect(markup).toContain('role="group" aria-label="12 additions, 3 deletions"');
  });

  it("keeps the fold-all-folders control for the tree alone", () => {
    expect(renderCard("tree")).toContain('aria-label="Collapse all folders"');
    for (const layout of FLAT_LAYOUTS) {
      expect(renderCard(layout)).not.toContain('aria-label="Collapse all folders"');
    }
  });

  /*
   * A layout that quietly renders like `rows` is still a passing test if all
   * the test asks is whether the file names appear. Each of these is the one
   * mark that makes its layout a different choice from the others.
   *
   * Rendered without the card around it, so the card's own chrome cannot
   * satisfy an assertion the rows were supposed to.
   */
  it.each([
    { layout: "stat", mark: "bg-success/70", name: "the add/delete weight bar" },
    { layout: "cards", mark: "border-border/70", name: "a border per file" },
    { layout: "split", mark: "sm:grid-cols-2", name: "a second column" },
    { layout: "strip", mark: "py-0.5", name: "rows tighter than every other layout's" },
  ] as const)("gives $layout $name, and rows none of it", ({ layout, mark }) => {
    expect(renderList(layout)).toContain(mark);
    expect(renderList("rows")).not.toContain(mark);
  });
});
