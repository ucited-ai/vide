import { EditorId } from "@vide/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { editorPreferenceRank, resolveAndPersistPreferredEditor } from "./editorPreferences";
import { removeLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

const LAST_EDITOR_KEY = "vide:last-editor";

describe("resolveAndPersistPreferredEditor", () => {
  beforeEach(() => {
    removeLocalStorageItem(LAST_EDITOR_KEY);
  });

  it("defaults to VS Code when nothing is stored", () => {
    expect(resolveAndPersistPreferredEditor(["cursor", "vscode", "file-manager"])).toBe("vscode");
  });

  it("falls back to Cursor when VS Code is not installed", () => {
    expect(resolveAndPersistPreferredEditor(["zed", "cursor", "file-manager"])).toBe("cursor");
  });

  it("prefers any editor over the file manager", () => {
    expect(resolveAndPersistPreferredEditor(["file-manager", "zed"])).toBe("zed");
  });

  it("uses the file manager only when it is the sole target", () => {
    expect(resolveAndPersistPreferredEditor(["file-manager"])).toBe("file-manager");
  });

  it("keeps a stored editor that is still installed", () => {
    setLocalStorageItem(LAST_EDITOR_KEY, "cursor", EditorId);
    expect(resolveAndPersistPreferredEditor(["cursor", "vscode", "file-manager"])).toBe("cursor");
  });

  it("replaces a stored editor that is no longer installed", () => {
    setLocalStorageItem(LAST_EDITOR_KEY, "zed", EditorId);
    expect(resolveAndPersistPreferredEditor(["cursor", "vscode", "file-manager"])).toBe("vscode");
  });
});

describe("editorPreferenceRank", () => {
  it("orders VS Code, then Cursor, then the rest, with the file manager last", () => {
    const ranked = ["file-manager", "zed", "cursor", "vscode"] satisfies EditorId[];
    expect([...ranked].sort((a, b) => editorPreferenceRank(a) - editorPreferenceRank(b))).toEqual([
      "vscode",
      "cursor",
      "zed",
      "file-manager",
    ]);
  });
});
