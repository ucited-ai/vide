import { ChatChangedFilesLayout } from "@vide/contracts/settings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { type TurnFileDiffs } from "../../hooks/useTurnFileDiffs";
import { ChangedFilesList } from "./ChangedFilesList";

const FILES = [
  { path: "apps/web/src/App.tsx", kind: "modified", additions: 12, deletions: 3 },
  { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
];

const NO_DIFFS: TurnFileDiffs = { byPath: new Map(), isPending: false, error: null };

function renderList(layout: Exclude<ChatChangedFilesLayout, "tree">): string {
  return renderToStaticMarkup(
    <ChangedFilesList
      diffs={NO_DIFFS}
      files={FILES}
      layout={layout}
      openPaths={new Set()}
      onTogglePath={() => {}}
      resolvedTheme="light"
    />,
  );
}

const FLAT_LAYOUTS = ChatChangedFilesLayout.literals.filter((layout) => layout !== "tree");

describe("ChangedFilesList layouts", () => {
  it.each([...FLAT_LAYOUTS])("names every changed file in the %s layout", (layout) => {
    const markup = renderList(layout);

    expect(markup).toContain(`data-changed-files-layout="${layout}"`);
    expect(markup).toContain("App.tsx");
    expect(markup).toContain("README.md");
    expect(markup).toContain('role="group" aria-label="12 additions, 3 deletions"');
  });

  it("opens a file rather than sending the reader to the panel", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesList
        diffs={NO_DIFFS}
        files={FILES}
        layout="rows"
        openPaths={new Set(["README.md"])}
        onTogglePath={() => {}}
        resolvedTheme="light"
      />,
    );

    /* The row states whether its diff is open; with no patch fetched yet, the
       opened row says so rather than rendering an empty box. */
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain("open the full diff");
  });

  /*
   * A layout that quietly renders like `rows` is still a passing test if all
   * the test asks is whether the file names appear. Each of these is the one
   * mark that makes its layout a different choice from the others.
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

describe("ChangedFilesList diff state", () => {
  it("says the diff is on its way rather than showing an empty file", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesList
        diffs={{ byPath: new Map(), isPending: true, error: null }}
        files={FILES}
        layout="rows"
        openPaths={new Set(["README.md"])}
        onTogglePath={() => {}}
        resolvedTheme="light"
      />,
    );

    expect(markup).toContain("Loading the diff");
  });
});
