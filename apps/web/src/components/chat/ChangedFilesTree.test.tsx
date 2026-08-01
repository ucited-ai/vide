import { TurnId } from "@vide/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { type TurnFileDiffs } from "../../hooks/useTurnFileDiffs";
import { ChangedFilesCard, ChangedFilesTree } from "./ChangedFilesTree";

const NO_DIFFS: TurnFileDiffs = { byPath: new Map(), isPending: false, error: null };

const DIFF_TARGET = {
  turnId: TurnId.make("turn-1"),
  checkpointTurnCount: 2,
  environmentId: null,
  threadId: null,
};

describe("ChangedFilesCard", () => {
  it("states the count and the weight on one line, and keeps the singular", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        allDirectoriesExpanded
        diffTarget={DIFF_TARGET}
        expanded
        files={[{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }]}
        layout="tree"
        onExpandedChange={() => {}}
        onOpenTurnDiff={() => {}}
        onToggleAllDirectories={() => {}}
        resolvedTheme="light"
        turnId={TurnId.make("turn-1")}
      />,
    );

    expect(markup).toContain('data-changed-files-state="expanded"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="group" aria-label="2 additions, 1 deletions"');
    expect(markup).toContain("Changed 1 file");
    expect(markup).not.toContain("Changed 1 files");
    /* The way out to the panel, and the tree's own control, sit after the list —
       the head row is the count and nothing else. */
    expect(markup).toContain('aria-label="Open diff"');
    expect(markup).toContain('aria-label="Collapse all folders"');
  });

  it("keeps a collapsed change to its one line", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        allDirectoriesExpanded={false}
        diffTarget={DIFF_TARGET}
        expanded={false}
        files={[{ path: "apps/web/src/App.tsx", kind: "modified", additions: 120, deletions: 20 }]}
        layout="tree"
        onExpandedChange={() => {}}
        onOpenTurnDiff={() => {}}
        onToggleAllDirectories={() => {}}
        resolvedTheme="light"
        turnId={TurnId.make("turn-1")}
      />,
    );

    expect(markup).toContain('data-changed-files-state="collapsed"');
    expect(markup).toContain("Changed 1 file");
    /* Closed means nothing inside is mounted at all: a diff nobody has opened is
       not worth parsing on the chance that they will. */
    expect(markup).not.toContain("App.tsx");
    expect(markup).not.toContain('aria-label="Open diff"');
  });

  it("leaves the fold-all control to the tree", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        allDirectoriesExpanded
        diffTarget={DIFF_TARGET}
        expanded
        files={[{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }]}
        layout="rows"
        onExpandedChange={() => {}}
        onOpenTurnDiff={() => {}}
        onToggleAllDirectories={() => {}}
        resolvedTheme="light"
        turnId={TurnId.make("turn-1")}
      />,
    );

    expect(markup).toContain('data-changed-files-layout="rows"');
    expect(markup).not.toContain('aria-label="Collapse all folders"');
  });
});

describe("ChangedFilesTree", () => {
  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src"],
      hiddenLabels: ["index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: ["apps/server/src"],
      hiddenLabels: ["git", "provider", "GitCore.ts", "CodexAdapter.ts"],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: ["README.md", "packages"],
      hiddenLabels: ["shared/src", "contracts/src", "git.ts", "orchestration.ts"],
    },
  ])(
    "renders $name collapsed on the first render when collapse-all is active",
    ({ files, visibleLabels, hiddenLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          allDirectoriesExpanded={false}
          diffs={NO_DIFFS}
          files={files}
          openPaths={new Set()}
          onTogglePath={() => {}}
          resolvedTheme="light"
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
      for (const label of hiddenLabels) {
        expect(markup).not.toContain(label);
      }
    },
  );

  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src", "index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: [
        "apps/server/src",
        "git/Layers",
        "provider/Layers",
        "GitCore.ts",
        "CodexAdapter.ts",
      ],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: [
        "README.md",
        "packages",
        "shared/src",
        "contracts/src",
        "git.ts",
        "orchestration.ts",
      ],
    },
  ])(
    "renders $name expanded on the first render when expand-all is active",
    ({ files, visibleLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          allDirectoriesExpanded
          diffs={NO_DIFFS}
          files={files}
          openPaths={new Set()}
          onTogglePath={() => {}}
          resolvedTheme="light"
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
    },
  );
});
