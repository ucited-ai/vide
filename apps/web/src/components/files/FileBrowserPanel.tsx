import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from "@pierre/trees";
import type { EnvironmentId, ProjectEntry } from "@vide/contracts";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { serializeComposerFileLink } from "@vide/shared/composerTrigger";
import { useEffect, useMemo, useRef } from "react";

import { QualifiedLabel } from "~/components/chat/QualifiedLabel";
import { Separator } from "~/components/ui/separator";
import { toastManager } from "~/components/ui/toast";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { readLocalApi } from "~/localApi";
import { Vide_PIERRE_ICONS } from "~/pierre-icons";

import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  onOpenFile: (relativePath: string) => void;
}

/*
 * The tree renders its rows in shadow DOM, so its surface, ink, spacing, and
 * motion are only reachable through Pierre's override variables. Custom
 * properties cross the shadow boundary, so every value below is a theme token
 * rather than a colour of its own.
 *
 * Two of these names carry more than they look. Pierre calls the hover wash
 * `--trees-bg-muted`, not `--trees-hover-bg`, so the hover override this file
 * used to set named nothing and rows fell back to Pierre's default — a wash
 * mixed from its blue accent. Overriding the accent itself then retires the
 * remaining blue in one line, because the focus ring and the selected row's
 * border both derive from it.
 */
const TREE_UNSAFE_CSS = `
  :host {
    --trees-accent-override: var(--ink-tertiary);

    --trees-bg-override: var(--surface-content);
    --trees-bg-muted-override: var(--wash-hover);
    --trees-selected-bg-override: var(--wash-selected);
    --trees-selected-fg-override: var(--ink);
    --trees-search-bg-override: var(--surface-content);
    --trees-search-fg-override: var(--ink);

    --trees-fg-override: var(--ink);
    --trees-fg-muted-override: var(--ink-tertiary);

    --trees-border-color-override: var(--edge);
    --trees-indent-guide-bg-override: var(--edge);
    --trees-scrollbar-thumb-override: var(--edge-strong);

    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: var(--tree-font-size);
    --trees-border-radius-override: var(--radius);

    --trees-padding-inline-override: var(--tree-padding-inline);
    --trees-level-gap-override: var(--tree-level-gap);
  }

  [data-file-tree-search-container] {
    position: relative;
  }

  [data-file-tree-search-container]::before {
    position: absolute;
    z-index: 1;
    inset-inline-start: var(--tree-search-icon-inset);
    inset-block-start: 50%;
    width: var(--tree-search-icon-size);
    height: var(--tree-search-icon-size);
    background-color: var(--ink-tertiary);
    content: "";
    pointer-events: none;
    transform: translateY(-50%);
    mask: var(--tree-search-icon) center / contain no-repeat;
  }

  [data-file-tree-search-input] {
    padding-inline-start: var(--tree-search-input-start);
    border-color: var(--surface-content);
    border-radius: var(--tree-search-radius);
  }

  /* A directory only locates the file beneath it, so it recedes and the file
     name keeps primary ink — the same split QualifiedLabel makes in the
     transcript, expressed where these rows actually live. Selecting a folder
     brings it forward, because a selected row that stays muted reads as
     disabled. */
  [data-item-type='folder'] [data-item-section='content'] {
    color: var(--ink-secondary);
  }

  [data-item-type='folder'][data-item-selected='true'] [data-item-section='content'] {
    color: var(--trees-selected-fg);
  }

  [data-type='item'] {
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }
`;

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const entries = entriesQuery.data?.entries ?? [];
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(treePath), [entries]);
  const previousTreePathsRef = useRef<readonly string[]>([]);

  // The tree renders rows in shadow DOM and its anchor rect is unreliable, so
  // capture the right-click position ourselves; contextmenu is a composed
  // event, so a capture-phase listener sees it with viewport coordinates.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => {
    const capturePointer = (event: MouseEvent) => {
      contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    };
    document.addEventListener("contextmenu", capturePointer, true);
    return () => document.removeEventListener("contextmenu", capturePointer, true);
  }, []);

  const showEntryContextMenu = async (
    item: TreeContextMenuItem,
    context: TreeContextMenuOpenContext,
  ) => {
    const api = readLocalApi();
    if (!api) {
      context.close();
      return;
    }
    const relativePath = item.path.replace(/\/$/, "");
    const mention = serializeComposerFileLink(relativePath);
    const pointer = contextMenuPointerRef.current;
    const pointerIsFresh = pointer !== null && performance.now() - pointer.at < 1000;
    const anchorRect = context.anchorElement.getBoundingClientRect();
    const position = pointerIsFresh
      ? { x: pointer.x, y: pointer.y }
      : { x: anchorRect.left, y: anchorRect.bottom };
    try {
      const clicked = await api.contextMenu.show(
        [
          { id: "copy-mention", label: "Copy mention" },
          { id: "add-to-chat", label: "Add to chat" },
        ],
        position,
      );
      if (clicked === "copy-mention") {
        try {
          await writeTextToClipboard(mention);
          toastManager.add({ type: "success", title: "Mention copied", description: relativePath });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy mention",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "add-to-chat") {
        const composer = composerRef?.current;
        if (!composer) {
          toastManager.add({
            type: "error",
            title: "Unable to add to chat",
            description: "Open a chat for this project and try again.",
          });
          return;
        }
        const inserted = composer.insertTextAtEnd(`${mention} `, { ensureLeadingBoundary: true });
        if (!inserted) {
          toastManager.add({
            type: "error",
            title: "Unable to add to chat",
            description: "The chat isn't ready to accept input right now.",
          });
        }
      }
    } finally {
      context.close();
    }
  };
  const showEntryContextMenuRef = useRef(showEntryContextMenu);
  useEffect(() => {
    showEntryContextMenuRef.current = showEntryContextMenu;
  });

  const treeModelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);
  const dragMention = useMemo(
    () =>
      createFileTreeDragMentionController({
        deselect: (path) => treeModelRef.current?.getItem(path)?.deselect(),
      }),
    [],
  );
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          void showEntryContextMenuRef.current(item, context);
        },
      },
    },
    // Rows only need to be draggable so entries can be dropped into the chat
    // composer; rearranging files inside the tree stays off.
    dragAndDrop: { canDrop: () => false },
    // The explorer is denser than the app sidebar: it is a path index and often
    // needs to expose several nested levels in a narrow pane.
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    icons: Vide_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      dragMention.handleSelectionChange(selectedPaths);
      // Starting a drag selects the dragged row; that selection is a side
      // effect of the gesture, not a request to open the file.
      if (dragMention.isDragInProgress()) {
        return;
      }
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        onOpenFile(selectedPath);
      }
    },
    paths: [],
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths);
  }, [entryKinds, model, treePaths]);

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );
  // What the project name is qualified by: how much of it there is, or that we
  // are still counting.
  const indexLabel =
    entriesQuery.isPending && entriesQuery.data === null
      ? "Indexing…"
      : `${fileCount.toLocaleString()} files${entriesQuery.data?.truncated ? " · partial" : ""}`;

  // Tag tree drags with the composer mention payload. The row is read from
  // the composed event path (the tree's shadow root is open), so this does
  // not depend on running after the tree's own dragstart handler; the drag
  // data store is writable for every dragstart listener in the dispatch.
  // The capture phase runs before the tree's own dragstart handler selects
  // the dragged row, so the drag flag is up before that selection emits.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    treeModelRef.current = model;
  }, [model]);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const handleDragStart = (event: DragEvent) => dragMention.handleDragStart(event);
    const handleDragEnd = () => dragMention.handleDragEnd();
    panel.addEventListener("dragstart", handleDragStart, true);
    panel.addEventListener("dragend", handleDragEnd);
    return () => {
      panel.removeEventListener("dragstart", handleDragStart, true);
      panel.removeEventListener("dragend", handleDragEnd);
    };
  }, [dragMention]);

  return (
    <div
      ref={panelRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-(--surface-content)"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div className="surface-subheader gap-2 px-3">
        <div className="min-w-0 flex-1 truncate text-(length:--text-ui)">
          <QualifiedLabel name={projectName} trail={indexLabel} separator=" · " />
        </div>
      </div>
      <Separator />
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-(length:--text-ui) leading-relaxed text-destructive">
          {entriesQuery.error}
        </div>
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={{ colorScheme: resolvedTheme }}
        />
      )}
    </div>
  );
}
