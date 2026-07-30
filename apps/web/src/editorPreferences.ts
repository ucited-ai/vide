import { EDITORS, EditorId, EnvironmentId } from "@vide/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandFailure,
  type AtomCommandResult,
} from "@vide/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useCallback, useMemo } from "react";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";

const LAST_EDITOR_KEY = "vide:last-editor";

/**
 * Editors that win the default before anything else, most preferred first.
 *
 * Stated here rather than inferred from the order of `EDITORS` so that
 * reordering the contract table cannot silently change which editor the Open
 * button opens on a machine that has never picked one.
 */
const PREFERRED_EDITOR_ORDER: ReadonlyArray<EditorId> = ["vscode", "cursor"];

/** The file manager opens no code, so it only ever wins when nothing else is installed. */
const LAST_RESORT_EDITOR: EditorId = "file-manager";

/**
 * Sort key for `availableEditors`: {@link PREFERRED_EDITOR_ORDER} first, then the
 * remaining editors in contract order, with {@link LAST_RESORT_EDITOR} always last.
 */
export function editorPreferenceRank(editor: EditorId): number {
  const preferredIndex = PREFERRED_EDITOR_ORDER.indexOf(editor);
  if (preferredIndex !== -1) return preferredIndex;
  if (editor === LAST_RESORT_EDITOR) return Number.MAX_SAFE_INTEGER;
  return PREFERRED_EDITOR_ORDER.length + EDITORS.findIndex(({ id }) => id === editor);
}

function resolveDefaultEditor(availableEditors: ReadonlyArray<EditorId>): EditorId | null {
  let preferred: EditorId | null = null;
  for (const editor of availableEditors) {
    if (preferred === null || editorPreferenceRank(editor) < editorPreferenceRank(preferred)) {
      preferred = editor;
    }
  }
  return preferred;
}

export class PreferredEditorEnvironmentRequiredError extends Schema.TaggedErrorClass<PreferredEditorEnvironmentRequiredError>()(
  "PreferredEditorEnvironmentRequiredError",
  {
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot open ${this.targetPath} because no environment is selected.`;
  }
}

export class PreferredEditorUnavailableError extends Schema.TaggedErrorClass<PreferredEditorUnavailableError>()(
  "PreferredEditorUnavailableError",
  {
    environmentId: EnvironmentId,
    targetPath: Schema.String,
    availableEditorIds: Schema.Array(EditorId),
  },
) {
  override get message(): string {
    return `No available editor can open ${this.targetPath} in environment ${this.environmentId}.`;
  }
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return resolveDefaultEditor(availableEditors);
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditors.includes(stored)) return stored;
  const editor = resolveDefaultEditor(availableEditors);
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor;
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  type OpenInEditorError = AtomCommandFailure<Awaited<ReturnType<typeof openInEditor>>>;

  return useCallback(
    async (
      targetPath: string,
    ): Promise<
      AtomCommandResult<
        EditorId,
        | OpenInEditorError
        | PreferredEditorEnvironmentRequiredError
        | PreferredEditorUnavailableError
      >
    > => {
      if (environmentId === null) {
        return AsyncResult.failure(
          Cause.fail(
            new PreferredEditorEnvironmentRequiredError({
              targetPath,
            }),
          ),
        );
      }
      const editor = resolveAndPersistPreferredEditor(availableEditors);
      if (!editor) {
        return AsyncResult.failure(
          Cause.fail(
            new PreferredEditorUnavailableError({
              environmentId,
              targetPath,
              availableEditorIds: availableEditors,
            }),
          ),
        );
      }
      const result = await openInEditor({
        environmentId,
        input: {
          cwd: targetPath,
          editor,
        },
      });
      return mapAtomCommandResult(result, () => editor);
    },
    [availableEditors, environmentId, openInEditor],
  );
}
