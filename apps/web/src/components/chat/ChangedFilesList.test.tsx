import { TurnId } from "@vide/contracts";
import { ChatChangedFilesLayout } from "@vide/contracts/settings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

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

  it("shows the add/delete weight bar only where the layout asks for it", () => {
    // The bar is the whole difference between `stat` and `rows`; if it ever
    // stops being, the two variants have collapsed into one choice.
    expect(renderCard("stat")).toContain("bg-success/70");
    expect(renderCard("rows")).not.toContain("bg-success/70");
  });
});
